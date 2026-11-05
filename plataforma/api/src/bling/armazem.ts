import { and, eq, isNotNull, isNull, notInArray, sql } from 'drizzle-orm';

import type { Banco } from '../db/cliente.js';
import { clientes, produtos } from '../db/esquema.js';
import type {
  ClienteSincronizado,
  DadosSincronizacao,
  ProdutoSincronizado,
} from './sincronizacao.js';

type Transacao = Parameters<Parameters<Banco['transaction']>[0]>[0];

export type ModoGravacao = 'completa';

// Por que um registro lido do Bling ficou de fora.
export type MotivoPulado =
  | 'cnpj_invalido'
  | 'sem_nome'
  | 'cnpj_repetido'
  | 'codigo_repetido'
  | 'nome_repetido'
  | 'dados_invalidos';

export type ContagensGravacao = {
  inseridos: number;
  // Só as linhas que mudaram (dados, vínculo ou marca de inativo).
  atualizados: number;
  inativados: number;
  pulados: Partial<Record<MotivoPulado, number>>;
};

export type ResultadoGravacao = {
  clientes: ContagensGravacao;
  produtos: ContagensGravacao;
  // Agregados por motivo, nunca com nome ou documento.
  avisos: string[];
};

// Destino dos dados lidos do Bling.
export interface ArmazemSincronizacao {
  salvar(
    empresaId: string,
    dados: DadosSincronizacao,
    opcoes: { modo: ModoGravacao },
  ): Promise<ResultadoGravacao>;
}

const VIOLA_UNICO = '23505';
const VIOLA_CHECK = '23514';

type ErroPostgres = { code?: string; constraint_name?: string };

// O Drizzle embrulha o erro do Postgres em `cause`.
function erroPostgres(erro: unknown): ErroPostgres {
  const comCausa = erro as ErroPostgres & { cause?: ErroPostgres };
  return comCausa.cause?.code ? comCausa.cause : comCausa;
}

// Grava uma linha num SAVEPOINT: uma violação de unicidade ou de CHECK vira motivo de pulo e não aborta a
// transação. Qualquer outro erro sobe (e desfaz tudo).
async function gravarLinha(
  tx: Transacao,
  escrever: (sp: Transacao) => Promise<unknown>,
  motivoUnico: (restricao: string | undefined) => MotivoPulado,
): Promise<MotivoPulado | null> {
  try {
    await tx.transaction(async (sp) => {
      await escrever(sp);
    });
    return null;
  } catch (erro) {
    const { code, constraint_name: restricao } = erroPostgres(erro);
    if (code === VIOLA_UNICO) return motivoUnico(restricao);
    if (code === VIOLA_CHECK) return 'dados_invalidos';
    throw erro;
  }
}

const novasContagens = (): ContagensGravacao => ({
  inseridos: 0,
  atualizados: 0,
  inativados: 0,
  pulados: {},
});

function pular(contagens: ContagensGravacao, motivo: MotivoPulado): void {
  contagens.pulados[motivo] = (contagens.pulados[motivo] ?? 0) + 1;
}

// Linhas vinculadas primeiro: num CNPJ ou código repetido no Bling, fica o vínculo existente; sem vínculo, o
// primeiro lido.
function vinculadosPrimeiro<T extends { idBling: number }>(itens: T[], ids: Set<number>): T[] {
  return [
    ...itens.filter((item) => ids.has(item.idBling)),
    ...itens.filter((item) => !ids.has(item.idBling)),
  ];
}

type LinhaCliente = {
  id: string;
  idBling: number | null;
  cnpj: string;
  razaoSocial: string;
  nomeFantasia: string | null;
  inativoNoBlingEm: Date | null;
};

// Valida os CNPJs do lote numa consulta só, com a mesma função do CHECK da tabela.
async function cnpjsValidos(tx: Transacao, documentos: string[]): Promise<Set<string>> {
  const candidatos = [...new Set(documentos.filter((doc) => /^\d{14}$/.test(doc)))];
  if (candidatos.length === 0) return new Set();
  // Só dígitos: o literal de array é seguro.
  const linhas = await tx.execute<{ doc: string }>(
    sql`select doc from unnest(${`{${candidatos.join(',')}}`}::text[]) as d(doc) where cnpj_valido(doc)`,
  );
  return new Set(linhas.map((linha) => linha.doc));
}

async function salvarClientes(
  tx: Transacao,
  empresaId: string,
  lidos: ClienteSincronizado[],
  { modo, agora }: { modo: ModoGravacao; agora: Date },
): Promise<ContagensGravacao> {
  const contagens = novasContagens();
  const existentes: LinhaCliente[] = await tx
    .select({
      id: clientes.id,
      idBling: clientes.idBling,
      cnpj: clientes.cnpj,
      razaoSocial: clientes.razaoSocial,
      nomeFantasia: clientes.nomeFantasia,
      inativoNoBlingEm: clientes.inativoNoBlingEm,
    })
    .from(clientes)
    .where(eq(clientes.empresaId, empresaId));
  const porIdBling = new Map(
    existentes.flatMap((linha) => (linha.idBling === null ? [] : [[linha.idBling, linha]])),
  );
  const porCnpj = new Map(existentes.map((linha) => [linha.cnpj, linha]));
  const validos = await cnpjsValidos(
    tx,
    lidos.flatMap((cliente) => (cliente.documento ? [cliente.documento] : [])),
  );
  const motivoUnico = (restricao: string | undefined): MotivoPulado =>
    restricao === 'clientes_empresa_cnpj_unico' ? 'cnpj_repetido' : 'dados_invalidos';

  for (const lido of vinculadosPrimeiro(lidos, new Set(porIdBling.keys()))) {
    const cnpj = lido.documento ?? '';
    const razaoSocial = lido.nome.trim();
    const nomeFantasia = lido.fantasia;
    if (!validos.has(cnpj)) {
      pular(contagens, 'cnpj_invalido');
      continue;
    }
    if (!razaoSocial) {
      pular(contagens, 'sem_nome');
      continue;
    }

    const vinculada = porIdBling.get(lido.idBling);
    const doCnpj = porCnpj.get(cnpj);
    // Sem vínculo, adota a linha manual do mesmo CNPJ.
    const alvo = vinculada ?? (doCnpj?.idBling === null ? doCnpj : undefined);
    if (doCnpj && doCnpj !== alvo) {
      pular(contagens, 'cnpj_repetido');
      continue;
    }

    if (!alvo) {
      let inserida: LinhaCliente | undefined;
      const motivo = await gravarLinha(
        tx,
        async (sp) => {
          [inserida] = await sp
            .insert(clientes)
            .values({ empresaId, idBling: lido.idBling, cnpj, razaoSocial, nomeFantasia })
            .returning({
              id: clientes.id,
              idBling: clientes.idBling,
              cnpj: clientes.cnpj,
              razaoSocial: clientes.razaoSocial,
              nomeFantasia: clientes.nomeFantasia,
              inativoNoBlingEm: clientes.inativoNoBlingEm,
            });
        },
        motivoUnico,
      );
      if (motivo || !inserida) {
        pular(contagens, motivo ?? 'dados_invalidos');
        continue;
      }
      porIdBling.set(lido.idBling, inserida);
      porCnpj.set(cnpj, inserida);
      contagens.inseridos++;
      continue;
    }

    const mudou =
      alvo.idBling !== lido.idBling ||
      alvo.cnpj !== cnpj ||
      alvo.razaoSocial !== razaoSocial ||
      alvo.nomeFantasia !== nomeFantasia ||
      alvo.inativoNoBlingEm !== null;
    if (!mudou) continue;
    const motivo = await gravarLinha(
      tx,
      (sp) =>
        sp
          .update(clientes)
          .set({ idBling: lido.idBling, cnpj, razaoSocial, nomeFantasia, inativoNoBlingEm: null })
          .where(eq(clientes.id, alvo.id)),
      motivoUnico,
    );
    if (motivo) {
      pular(contagens, motivo);
      continue;
    }
    porCnpj.delete(alvo.cnpj);
    Object.assign(alvo, { idBling: lido.idBling, cnpj, razaoSocial, nomeFantasia });
    alvo.inativoNoBlingEm = null;
    porIdBling.set(lido.idBling, alvo);
    porCnpj.set(cnpj, alvo);
    contagens.atualizados++;
  }

  if (modo === 'completa')
    contagens.inativados = await marcarAusentes(tx, clientes, empresaId, lidos, agora);
  return contagens;
}

type LinhaProduto = {
  id: string;
  idBling: number | null;
  codigo: string | null;
  nome: string;
  inativoNoBlingEm: Date | null;
};

async function salvarProdutos(
  tx: Transacao,
  empresaId: string,
  lidos: ProdutoSincronizado[],
  { modo, agora }: { modo: ModoGravacao; agora: Date },
): Promise<ContagensGravacao> {
  const contagens = novasContagens();
  const colunas = {
    id: produtos.id,
    idBling: produtos.idBling,
    codigo: produtos.codigo,
    nome: produtos.nome,
    inativoNoBlingEm: produtos.inativoNoBlingEm,
  };
  const existentes: LinhaProduto[] = await tx
    .select(colunas)
    .from(produtos)
    .where(eq(produtos.empresaId, empresaId));
  const porIdBling = new Map(
    existentes.flatMap((linha) => (linha.idBling === null ? [] : [[linha.idBling, linha]])),
  );
  const porCodigo = new Map(
    existentes.flatMap((linha) => (linha.codigo === null ? [] : [[linha.codigo, linha]])),
  );
  const motivoUnico = (restricao: string | undefined): MotivoPulado => {
    if (restricao === 'produtos_empresa_codigo_unico') return 'codigo_repetido';
    if (restricao === 'produtos_empresa_nome_unico') return 'nome_repetido';
    return 'dados_invalidos';
  };

  for (const lido of vinculadosPrimeiro(lidos, new Set(porIdBling.keys()))) {
    const nome = lido.nome.trim();
    const codigo = lido.codigo;
    if (!nome) {
      pular(contagens, 'sem_nome');
      continue;
    }

    const vinculada = porIdBling.get(lido.idBling);
    const doCodigo = codigo === null ? undefined : porCodigo.get(codigo);
    // Sem vínculo, adota a linha manual do mesmo código; produto sem código só casa pelo id do Bling.
    const alvo = vinculada ?? (doCodigo?.idBling === null ? doCodigo : undefined);
    if (doCodigo && doCodigo !== alvo) {
      pular(contagens, 'codigo_repetido');
      continue;
    }

    if (!alvo) {
      let inserida: LinhaProduto | undefined;
      const motivo = await gravarLinha(
        tx,
        async (sp) => {
          [inserida] = await sp
            .insert(produtos)
            .values({ empresaId, idBling: lido.idBling, codigo, nome })
            .returning(colunas);
        },
        motivoUnico,
      );
      if (motivo || !inserida) {
        pular(contagens, motivo ?? 'dados_invalidos');
        continue;
      }
      porIdBling.set(lido.idBling, inserida);
      if (codigo !== null) porCodigo.set(codigo, inserida);
      contagens.inseridos++;
      continue;
    }

    const mudou =
      alvo.idBling !== lido.idBling ||
      alvo.codigo !== codigo ||
      alvo.nome !== nome ||
      alvo.inativoNoBlingEm !== null;
    if (!mudou) continue;
    const motivo = await gravarLinha(
      tx,
      (sp) =>
        sp
          .update(produtos)
          .set({ idBling: lido.idBling, codigo, nome, inativoNoBlingEm: null })
          .where(eq(produtos.id, alvo.id)),
      motivoUnico,
    );
    if (motivo) {
      pular(contagens, motivo);
      continue;
    }
    if (alvo.codigo !== null) porCodigo.delete(alvo.codigo);
    Object.assign(alvo, { idBling: lido.idBling, codigo, nome });
    alvo.inativoNoBlingEm = null;
    porIdBling.set(lido.idBling, alvo);
    if (codigo !== null) porCodigo.set(codigo, alvo);
    contagens.atualizados++;
  }

  if (modo === 'completa')
    contagens.inativados = await marcarAusentes(tx, produtos, empresaId, lidos, agora);
  return contagens;
}

// Na completa, o que tem vínculo com o Bling e não veio na leitura foi inativado ou excluído lá. A linha fica
// (e as artes também); só sai da busca.
async function marcarAusentes(
  tx: Transacao,
  tabela: typeof clientes | typeof produtos,
  empresaId: string,
  lidos: { idBling: number }[],
  agora: Date,
): Promise<number> {
  const ids = lidos.map((lido) => lido.idBling);
  const marcadas = await tx
    .update(tabela)
    .set({ inativoNoBlingEm: agora })
    .where(
      and(
        eq(tabela.empresaId, empresaId),
        isNotNull(tabela.idBling),
        isNull(tabela.inativoNoBlingEm),
        ...(ids.length > 0 ? [notInArray(tabela.idBling, ids)] : []),
      ),
    )
    .returning({ id: tabela.id });
  return marcadas.length;
}

const plural = (n: number, singular: string, varios: string) => (n === 1 ? singular : varios);

const TEXTOS_MOTIVO: Record<MotivoPulado, string> = {
  cnpj_invalido: 'sem CNPJ válido',
  sem_nome: 'sem nome',
  cnpj_repetido: 'com CNPJ repetido',
  codigo_repetido: 'com código repetido',
  nome_repetido: 'com nome repetido',
  dados_invalidos: 'com dados inválidos',
};

// "8 clientes sem CNPJ válido ficaram de fora." — um aviso por motivo, nunca por registro.
export function avisosDaGravacao({ clientes: c, produtos: p }: Omit<ResultadoGravacao, 'avisos'>) {
  const avisos: string[] = [];
  for (const [contagens, singular, varios] of [
    [c, 'cliente', 'clientes'],
    [p, 'produto', 'produtos'],
  ] as const) {
    for (const [motivo, texto] of Object.entries(TEXTOS_MOTIVO) as [MotivoPulado, string][]) {
      const n = contagens.pulados[motivo] ?? 0;
      if (n > 0)
        avisos.push(
          `${n} ${plural(n, singular, varios)} ${texto} ${plural(n, 'ficou', 'ficaram')} de fora.`,
        );
    }
  }
  return avisos;
}

// Grava em `clientes` e `produtos` numa transação só. O Bling é a fonte da verdade dos campos sincronizados;
// cadastros manuais são adotados pelo CNPJ (cliente) ou pelo código (produto).
export function criarArmazemPostgres({
  db,
  relogio = () => new Date(),
}: {
  db: Banco;
  relogio?: () => Date;
}): ArmazemSincronizacao {
  return {
    salvar(empresaId, dados, { modo }) {
      const agora = relogio();
      return db.transaction(async (tx) => {
        const resultado = {
          clientes: await salvarClientes(tx, empresaId, dados.clientes, { modo, agora }),
          produtos: await salvarProdutos(tx, empresaId, dados.produtos, { modo, agora }),
        };
        return { ...resultado, avisos: avisosDaGravacao(resultado) };
      });
    },
  };
}
