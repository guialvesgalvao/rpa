import type { EtapaSincronizacaoBling } from '@plataforma/contratos';
import { z } from 'zod';

import { type AcessoBling, type ClienteBling, ErroBlingNaoEncontrado } from './cliente.js';
import { formatarDataHoraBling } from './datas.js';

export type ProdutoSincronizado = {
  idBling: number;
  codigo: string | null;
  nome: string;
  formato: string;
  idProdutoPai: number | null;
};

export type ClienteSincronizado = {
  idBling: number;
  nome: string;
  fantasia: string | null;
  tipoPessoa: 'J' | 'F' | 'E' | null;
  // Só dígitos (CPF ou CNPJ).
  documento: string | null;
};

// `incremental` lê só o que foi incluído ou alterado no Bling entre `desde` e `ate`.
export type ModoSincronizacao =
  { tipo: 'completa' } | { tipo: 'incremental'; desde: Date; ate: Date };

export type DadosSincronizacao = {
  // O modo efetivo: um incremental com janela grande demais vira completa.
  modo: ModoSincronizacao['tipo'];
  produtos: ProdutoSincronizado[];
  // Só os contatos ativos; os inativos da leitura vão para `contatosInativos` (ids do Bling).
  clientes: ClienteSincronizado[];
  contatosInativos: number[];
  avisos: string[];
};

export type ProgressoSincronizacao = {
  etapa: EtapaSincronizacaoBling;
  lidos: number;
  total: number | null;
};

export type OpcoesSincronizacao = {
  acesso: AcessoBling;
  // Padrão: completa.
  modo?: ModoSincronizacao;
  aoProgredir?: (progresso: ProgressoSincronizacao) => void;
  sinal?: AbortSignal;
};

// Só os campos usados; o zod descarta o resto (nenhum dado além destes sai do Bling).
const textoOuNulo = z
  .string()
  .nullish()
  .transform((valor) => (valor?.trim() ? valor.trim() : null));
const idOuNulo = z
  .number()
  .int()
  .nullish()
  .transform((valor) => (valor ? valor : null));

const EsquemaProduto = z.object({
  id: z.number().int(),
  idProdutoPai: idOuNulo,
  nome: z.string(),
  codigo: textoOuNulo,
  formato: z.string(),
});

const EsquemaTipoContato = z.object({ id: z.number().int(), descricao: z.string() });

const EsquemaContato = z.object({
  id: z.number().int(),
  nome: z.string(),
  situacao: z.string(),
  numeroDocumento: textoOuNulo,
});

const EsquemaDetalheContato = z.object({
  id: z.number().int(),
  nome: z.string(),
  fantasia: textoOuNulo,
  tipo: z.string().nullish(),
  numeroDocumento: textoOuNulo,
});

// `criterio=2`: produtos ativos. `criterio=1`: todos os contatos (o padrão do Bling é só os últimos incluídos).
const CRITERIO_PRODUTOS_ATIVOS = 2;
const CRITERIO_CONTATOS_TODOS = 1;
const SITUACAO_ATIVO = 'A';
const TIPOS_PESSOA = ['J', 'F', 'E'] as const;
// O Bling recusa (400) filtros de data com mais de 1 ano; 365 dias deixa margem nos anos bissextos.
export const JANELA_MAXIMA_MS = 365 * 24 * 60 * 60 * 1000;

export const AVISO_SEM_TIPO_CLIENTE =
  'Tipo de contato "Cliente" não encontrado no Bling; foram lidos todos os contatos ativos.';
export const avisoDetalheAusente = (idBling: number) =>
  `Contato ${idBling} não encontrado no detalhe; ficaram os dados da listagem.`;

const normalizar = (texto: string) =>
  texto
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .trim()
    .toLowerCase();

const soDigitos = (documento: string | null) => documento?.replace(/\D/g, '') || null;

const tipoPessoa = (tipo: string | null | undefined): ClienteSincronizado['tipoPessoa'] =>
  TIPOS_PESSOA.find((t) => t === tipo) ?? null;

function modoEfetivo(modo: ModoSincronizacao): ModoSincronizacao {
  if (modo.tipo === 'incremental' && modo.ate.getTime() - modo.desde.getTime() > JANELA_MAXIMA_MS)
    return { tipo: 'completa' };
  return modo;
}

// Completa: uma listagem sem filtro de data. Incremental: uma pela alteração e outra pela inclusão (não se
// sabe se toda inclusão conta como alteração no Bling), unidas pelo id.
function filtrosDeData(modo: ModoSincronizacao): Record<string, string>[] {
  if (modo.tipo === 'completa') return [{}];
  const desde = formatarDataHoraBling(modo.desde);
  const ate = formatarDataHoraBling(modo.ate);
  return [
    { dataAlteracaoInicial: desde, dataAlteracaoFinal: ate },
    { dataInclusaoInicial: desde, dataInclusaoFinal: ate },
  ];
}

async function listarUnindo<T extends { id: number }>(
  cliente: Pick<ClienteBling, 'listarTodas'>,
  caminho: string,
  parametros: Record<string, string | number>,
  filtros: Record<string, string>[],
  esquema: z.ZodType<T>,
  acesso: AcessoBling,
  aoPaginar: (lidos: number) => void,
  sinal: AbortSignal | undefined,
): Promise<T[]> {
  const porId = new Map<number, T>();
  let lidosAntes = 0;
  for (const filtro of filtros) {
    const lista = await cliente.listarTodas(
      caminho,
      { ...parametros, ...filtro },
      esquema,
      acesso,
      (lidos) => aoPaginar(lidosAntes + lidos),
      sinal,
    );
    lidosAntes += lista.length;
    for (const item of lista) if (!porId.has(item.id)) porId.set(item.id, item);
  }
  return [...porId.values()];
}

// Lê produtos ativos, contatos do tipo Cliente e o detalhe de cada contato ativo. Só GET no Bling.
export async function sincronizarBling(
  cliente: Pick<ClienteBling, 'listarTodas' | 'obter'>,
  {
    acesso,
    modo: modoPedido = { tipo: 'completa' },
    aoProgredir = () => {},
    sinal,
  }: OpcoesSincronizacao,
): Promise<DadosSincronizacao> {
  const modo = modoEfetivo(modoPedido);
  const filtros = filtrosDeData(modo);
  // Toda requisição passa por aqui: com o sinal abortado, para antes da próxima chamada.
  const acessoComSinal: AcessoBling = () => {
    sinal?.throwIfAborted();
    return acesso();
  };
  const avisos: string[] = [];

  aoProgredir({ etapa: 'produtos', lidos: 0, total: null });
  const produtos = (
    await listarUnindo(
      cliente,
      '/produtos',
      { criterio: CRITERIO_PRODUTOS_ATIVOS },
      filtros,
      EsquemaProduto,
      acessoComSinal,
      (lidos) => aoProgredir({ etapa: 'produtos', lidos, total: null }),
      sinal,
    )
  ).map((p): ProdutoSincronizado => ({
    idBling: p.id,
    codigo: p.codigo,
    nome: p.nome,
    formato: p.formato,
    idProdutoPai: p.idProdutoPai,
  }));

  aoProgredir({ etapa: 'clientes', lidos: 0, total: null });
  const tipos = await cliente.obter(
    '/contatos/tipos',
    z.array(EsquemaTipoContato),
    acessoComSinal,
    sinal,
  );
  const tipoCliente = tipos.find((t) => normalizar(t.descricao) === 'cliente');
  if (!tipoCliente) avisos.push(AVISO_SEM_TIPO_CLIENTE);
  const contatos = await listarUnindo(
    cliente,
    '/contatos',
    {
      criterio: CRITERIO_CONTATOS_TODOS,
      ...(tipoCliente && { idTipoContato: tipoCliente.id }),
    },
    filtros,
    EsquemaContato,
    acessoComSinal,
    (lidos) => aoProgredir({ etapa: 'clientes', lidos, total: null }),
    sinal,
  );
  const ativos = contatos.filter((c) => c.situacao === SITUACAO_ATIVO);
  const contatosInativos = contatos.filter((c) => c.situacao !== SITUACAO_ATIVO).map((c) => c.id);

  const clientes: ClienteSincronizado[] = [];
  aoProgredir({ etapa: 'detalhes', lidos: 0, total: ativos.length });
  for (const contato of ativos) {
    try {
      const detalhe = await cliente.obter(
        `/contatos/${contato.id}`,
        EsquemaDetalheContato,
        acessoComSinal,
        sinal,
      );
      clientes.push({
        idBling: contato.id,
        nome: detalhe.nome,
        fantasia: detalhe.fantasia,
        tipoPessoa: tipoPessoa(detalhe.tipo),
        documento: soDigitos(detalhe.numeroDocumento),
      });
    } catch (erro) {
      if (!(erro instanceof ErroBlingNaoEncontrado)) throw erro;
      avisos.push(avisoDetalheAusente(contato.id));
      clientes.push({
        idBling: contato.id,
        nome: contato.nome,
        fantasia: null,
        tipoPessoa: null,
        documento: soDigitos(contato.numeroDocumento),
      });
    }
    aoProgredir({ etapa: 'detalhes', lidos: clientes.length, total: ativos.length });
  }

  return { modo: modo.tipo, produtos, clientes, contatosInativos, avisos };
}
