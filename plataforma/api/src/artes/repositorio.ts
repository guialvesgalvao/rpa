import {
  type ArteDoProduto,
  type Cliente,
  type Opcao,
  PADRAO_INSUMO,
  type PaginaClientes,
  type ProdutoDoCliente,
} from '@plataforma/contratos';
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';

import type { Banco } from '../db/cliente.js';
import {
  arteMaquinas,
  artes,
  clientes,
  cores,
  empresas,
  maquinas,
  produtos,
} from '../db/esquema.js';

// Sem maiúsculas nem acentos, espaços colapsados. Com dígitos no termo a pontuação sai, para o CNPJ casar
// com ou sem máscara (`busca` guarda o CNPJ só com dígitos).
export function normalizarTermo(termo: string): string {
  const base = termo
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
  if (!/\d/.test(base)) return base;
  return base
    .replace(/[^\p{L}\p{N} ]/gu, '')
    .replace(/ +/g, ' ')
    .trim();
}

// Escapa os curingas do LIKE para o termo valer literalmente.
const escaparLike = (termo: string) => termo.replace(/[\\%_]/g, '\\$&');

type Cursor = { chave: string; id: string };

export function codificarCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify([cursor.chave, cursor.id])).toString('base64url');
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const ehUuid = (valor: string) => UUID.test(valor);

// `null` para cursor malformado.
export function decodificarCursor(cursor: string): Cursor | null {
  try {
    const dados: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (!Array.isArray(dados) || dados.length !== 2) return null;
    const [chave, id] = dados as unknown[];
    return typeof chave === 'string' && typeof id === 'string' && ehUuid(id) ? { chave, id } : null;
  } catch {
    return null;
  }
}

// Mesma expressão do índice `clientes_ordem_idx`.
const chaveOrdem = sql<string>`lower(f_unaccent(${clientes.nomeExibicao}))`;

export async function idDaEmpresa(db: Banco, slug: string): Promise<string | null> {
  const [empresa] = await db
    .select({ id: empresas.id })
    .from(empresas)
    .where(eq(empresas.slug, slug));
  return empresa?.id ?? null;
}

export async function empresaPorId(
  db: Banco,
  id: string,
): Promise<{ slug: string; nome: string } | null> {
  const [empresa] = await db
    .select({ slug: empresas.slug, nome: empresas.nome })
    .from(empresas)
    .where(eq(empresas.id, id));
  return empresa ?? null;
}

const colunasCliente = {
  id: clientes.id,
  nomeExibicao: clientes.nomeExibicao,
  razaoSocial: clientes.razaoSocial,
  nomeFantasia: clientes.nomeFantasia,
  cnpj: clientes.cnpj,
};

// `nome_exibicao` é coluna gerada (nunca nula no banco), mas o Drizzle a tipa como anulável.
const paraCliente = (linha: {
  id: string;
  nomeExibicao: string | null;
  razaoSocial: string;
  nomeFantasia: string | null;
  cnpj: string;
}): Cliente => ({ ...linha, nomeExibicao: linha.nomeExibicao ?? linha.razaoSocial });

export type FiltroClientes = {
  busca?: string;
  cursor: Cursor | null;
  limite: number;
  // Página numerada (a partir de 1): usa OFFSET e devolve o `total`; ignora o cursor.
  pagina?: number;
};

// Duas formas de paginar na mesma ordem (nome sem acento, id), estável com nomes iguais: cursor (keyset),
// usado pelo app antigo e por `clientePorCnpj`, e página numerada (OFFSET + total), usada pelas listas com
// páginas. Clientes inativos ou excluídos no Bling ficam de fora; `buscarCliente` ainda os encontra, para as
// artes continuarem acessíveis.
export async function listarClientes(
  db: Banco,
  empresaId: string,
  { busca, cursor, limite, pagina }: FiltroClientes,
): Promise<PaginaClientes> {
  const termo = busca ? normalizarTermo(busca) : '';
  const condicoes = [eq(clientes.empresaId, empresaId), isNull(clientes.inativoNoBlingEm)];
  if (termo) {
    // Também acha o revendedor pelo cliente final das artes dele (ADR 0017). A busca por CNPJ do app
    // (`clientePorCnpj`) filtra pelo CNPJ exato, então um acerto a mais aqui não a afeta.
    const padrao = sql`'%' || f_unaccent(${escaparLike(termo)}) || '%'`;
    condicoes.push(
      sql`(${clientes.busca} like ${padrao} or exists (select 1 from ${artes} a where a.cliente_id = ${clientes.id} and a.empresa_id = ${clientes.empresaId} and a.cliente_final_chave like ${padrao}))`,
    );
  }

  if (pagina !== undefined) {
    const filtro = and(...condicoes);
    const [linhas, [contagem]] = await Promise.all([
      db
        .select(colunasCliente)
        .from(clientes)
        .where(filtro)
        .orderBy(asc(chaveOrdem), asc(clientes.id))
        .limit(limite)
        .offset((pagina - 1) * limite),
      db
        .select({ total: sql<number>`count(*)::int` })
        .from(clientes)
        .where(filtro),
    ]);
    return { itens: linhas.map(paraCliente), proximoCursor: null, total: contagem?.total ?? 0 };
  }

  if (cursor) {
    condicoes.push(sql`(${chaveOrdem}, ${clientes.id}) > (${cursor.chave}, ${cursor.id}::uuid)`);
  }

  const linhas = await db
    .select({ ...colunasCliente, chave: chaveOrdem })
    .from(clientes)
    .where(and(...condicoes))
    .orderBy(asc(chaveOrdem), asc(clientes.id))
    .limit(limite + 1);

  const itensDaPagina = linhas.slice(0, limite);
  const ultimo = itensDaPagina.at(-1);
  return {
    itens: itensDaPagina.map(({ chave: _chave, ...linha }) => paraCliente(linha)),
    proximoCursor:
      linhas.length > limite && ultimo
        ? codificarCursor({ chave: ultimo.chave, id: ultimo.id })
        : null,
  };
}

// Cliente de outra empresa não aparece: `null`.
export async function buscarCliente(
  db: Banco,
  empresaId: string,
  id: string,
): Promise<Cliente | null> {
  const [linha] = await db
    .select(colunasCliente)
    .from(clientes)
    .where(and(eq(clientes.id, id), eq(clientes.empresaId, empresaId)));
  return linha ? paraCliente(linha) : null;
}

const ordemProduto = sql`lower(f_unaccent(${produtos.nome}))`;

// Produto final: sem código ou com código sem letra. Insumos (código com letra, ADR 0015) ficam fora das listas
// de Artes; `buscarProduto` e as artes já gravadas continuam acessíveis pelo id.
const naoEhInsumo = sql`(${produtos.codigo} is null or ${produtos.codigo} !~ ${PADRAO_INSUMO})`;

// Só os produtos com ao menos uma arte para o cliente.
export function produtosDoCliente(
  db: Banco,
  empresaId: string,
  clienteId: string,
): Promise<ProdutoDoCliente[]> {
  return db
    .select({
      id: produtos.id,
      nome: produtos.nome,
      codigo: produtos.codigo,
      quantidadeArtes: sql<number>`count(${artes.id})::int`,
    })
    .from(artes)
    .innerJoin(produtos, eq(produtos.id, artes.produtoId))
    .where(and(eq(artes.empresaId, empresaId), eq(artes.clienteId, clienteId), naoEhInsumo))
    .groupBy(produtos.id, produtos.nome, produtos.codigo)
    .orderBy(asc(ordemProduto), asc(produtos.id));
}

// Produto de outra empresa não aparece: `null`.
export async function buscarProduto(
  db: Banco,
  empresaId: string,
  id: string,
): Promise<Opcao | null> {
  const [linha] = await db
    .select({ id: produtos.id, nome: produtos.nome })
    .from(produtos)
    .where(and(eq(produtos.id, id), eq(produtos.empresaId, empresaId)));
  return linha ?? null;
}

// Artes do cliente para um produto, da mais nova para a mais antiga (`id` desempata criações no mesmo instante).
export async function artesDoProduto(
  db: Banco,
  empresaId: string,
  clienteId: string,
  produtoId: string,
): Promise<ArteDoProduto[]> {
  const linhas = await db
    .select({
      id: artes.id,
      nome: artes.nome,
      criadoEm: artes.criadoEm,
      corId: cores.id,
      corNome: cores.nome,
      pdfId: artes.pdfId,
      imagemId: artes.imagemId,
      clienteFinal: artes.clienteFinal,
      // Pedido do Bling da tarefa que gerou a arte (subconsulta: a lista não pode repetir a arte).
      pedidoNumero: sql<
        string | null
      >`(select t.pedido_numero from tarefas_arte t where t.arte_id = ${artes.id} and t.pedido_numero is not null limit 1)`,
    })
    .from(artes)
    .innerJoin(cores, eq(cores.id, artes.corId))
    .where(
      and(
        eq(artes.empresaId, empresaId),
        eq(artes.clienteId, clienteId),
        eq(artes.produtoId, produtoId),
      ),
    )
    .orderBy(desc(artes.criadoEm), desc(artes.id));
  if (linhas.length === 0) return [];

  const vinculos = await db
    .select({ arteId: arteMaquinas.arteId, id: maquinas.id, nome: maquinas.nome })
    .from(arteMaquinas)
    .innerJoin(maquinas, eq(maquinas.id, arteMaquinas.maquinaId))
    .where(
      inArray(
        arteMaquinas.arteId,
        linhas.map((linha) => linha.id),
      ),
    )
    .orderBy(asc(maquinas.nome));

  return linhas.map((linha) => ({
    id: linha.id,
    nome: linha.nome,
    cor: { id: linha.corId, nome: linha.corNome },
    maquinas: vinculos
      .filter((vinculo) => vinculo.arteId === linha.id)
      .map(({ id, nome }) => ({ id, nome })),
    criadoEm: linha.criadoEm.toISOString(),
    temPdf: linha.pdfId !== null,
    temImagem: linha.imagemId !== null,
    clienteFinal: linha.clienteFinal,
    pedidoNumero: linha.pedidoNumero,
  }));
}

// Id do arquivo (imagem ou PDF) da arte; `null` quando a arte não existe na empresa ou não tem o arquivo.
// O conteúdo é lido por `lerArquivo`, de onde estiver (bytea ou bucket).
export async function arquivoDaArte(
  db: Banco,
  empresaId: string,
  arteId: string,
  tipo: 'imagem' | 'pdf',
): Promise<string | null> {
  const [linha] = await db
    .select({ arquivoId: tipo === 'imagem' ? artes.imagemId : artes.pdfId })
    .from(artes)
    .where(and(eq(artes.id, arteId), eq(artes.empresaId, empresaId)));
  return linha?.arquivoId ?? null;
}

// Produtos inativos ou excluídos no Bling ficam de fora; `buscarProduto` ainda os encontra.
export function listarProdutos(db: Banco, empresaId: string): Promise<Opcao[]> {
  return db
    .select({ id: produtos.id, nome: produtos.nome })
    .from(produtos)
    .where(and(eq(produtos.empresaId, empresaId), isNull(produtos.inativoNoBlingEm), naoEhInsumo))
    .orderBy(asc(ordemProduto), asc(produtos.id));
}

export const listarCores = (db: Banco): Promise<Opcao[]> =>
  db.select({ id: cores.id, nome: cores.nome }).from(cores).orderBy(asc(cores.nome));

// Nome já validado (`validarNovaCor`); espaços em volta e repetidos saem. Violação de unicidade (23505)
// fica para quem chama.
export async function criarCor(db: Banco, nome: string): Promise<Opcao> {
  const [linha] = await db
    .insert(cores)
    .values({ nome: nome.trim().replace(/\s+/g, ' ') })
    .returning({ id: cores.id, nome: cores.nome });
  if (!linha) throw new Error('A cor não foi criada.');
  return linha;
}

export const listarMaquinas = (db: Banco): Promise<Opcao[]> =>
  db.select({ id: maquinas.id, nome: maquinas.nome }).from(maquinas).orderBy(asc(maquinas.nome));
