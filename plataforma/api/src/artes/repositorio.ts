import type {
  ArteDoProduto,
  Cliente,
  Opcao,
  PaginaClientes,
  ProdutoDoCliente,
} from '@plataforma/contratos';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';

import type { Banco } from '../db/cliente.js';
import {
  arquivos,
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

export type FiltroClientes = { busca?: string; cursor: Cursor | null; limite: number };

// Paginação por cursor (keyset) em (nome sem acento, id): estável com nomes iguais.
export async function listarClientes(
  db: Banco,
  empresaId: string,
  { busca, cursor, limite }: FiltroClientes,
): Promise<PaginaClientes> {
  const termo = busca ? normalizarTermo(busca) : '';
  const condicoes = [eq(clientes.empresaId, empresaId)];
  if (termo) {
    condicoes.push(sql`${clientes.busca} like '%' || f_unaccent(${escaparLike(termo)}) || '%'`);
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

  const pagina = linhas.slice(0, limite);
  const ultimo = pagina.at(-1);
  return {
    itens: pagina.map(({ chave: _chave, ...linha }) => paraCliente(linha)),
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
      quantidadeArtes: sql<number>`count(${artes.id})::int`,
    })
    .from(artes)
    .innerJoin(produtos, eq(produtos.id, artes.produtoId))
    .where(and(eq(artes.empresaId, empresaId), eq(artes.clienteId, clienteId)))
    .groupBy(produtos.id, produtos.nome)
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
  }));
}

export type ImagemDaArte = { tipoMime: string; conteudo: Buffer };

// `null` quando a arte não existe na empresa ou não tem imagem.
export async function imagemDaArte(
  db: Banco,
  empresaId: string,
  arteId: string,
): Promise<ImagemDaArte | null> {
  const [linha] = await db
    .select({ tipoMime: arquivos.tipoMime, conteudo: arquivos.conteudo })
    .from(artes)
    .innerJoin(arquivos, eq(arquivos.id, artes.imagemId))
    .where(and(eq(artes.id, arteId), eq(artes.empresaId, empresaId)));
  return linha ?? null;
}

export function listarProdutos(db: Banco, empresaId: string): Promise<Opcao[]> {
  return db
    .select({ id: produtos.id, nome: produtos.nome })
    .from(produtos)
    .where(eq(produtos.empresaId, empresaId))
    .orderBy(asc(ordemProduto), asc(produtos.id));
}

export const listarCores = (db: Banco): Promise<Opcao[]> =>
  db.select({ id: cores.id, nome: cores.nome }).from(cores).orderBy(asc(cores.nome));

export const listarMaquinas = (db: Banco): Promise<Opcao[]> =>
  db.select({ id: maquinas.id, nome: maquinas.nome }).from(maquinas).orderBy(asc(maquinas.nome));
