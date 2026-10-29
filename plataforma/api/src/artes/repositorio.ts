import type { Cliente, Opcao, PaginaClientes, ProdutoDoCliente } from '@plataforma/contratos';
import { and, asc, eq, sql } from 'drizzle-orm';

import type { Banco } from '../db/cliente.js';
import { artes, clientes, cores, empresas, maquinas, produtos } from '../db/esquema.js';

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
