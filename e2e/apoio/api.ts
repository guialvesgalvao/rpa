import { type APIRequestContext, expect, request } from '@playwright/test';

import { SENHA, URL_API } from './ambiente.js';

// Chamadas diretas à API local da suíte, para preparar e conferir o que a tela não mostra.

export type Api = { ctx: APIRequestContext; fechar: () => Promise<void> };

export async function apiComo(email: string): Promise<Api> {
  const anonimo = await request.newContext({ baseURL: URL_API });
  const resposta = await anonimo.post('/v1/auth/entrar', {
    data: { email, senha: SENHA, origem: 'web' },
  });
  expect(resposta.status(), `login de ${email} na API`).toBe(200);
  const { acesso } = (await resposta.json()) as { acesso: string };
  await anonimo.dispose();
  const ctx = await request.newContext({
    baseURL: URL_API,
    extraHTTPHeaders: { authorization: `Bearer ${acesso}` },
  });
  return { ctx, fechar: () => ctx.dispose() };
}

export type ClienteApi = { id: string; cnpj: string; nomeExibicao: string };
export type ArteApi = {
  id: string;
  nome: string;
  cor: { nome: string };
  maquinas: { nome: string }[];
  temPdf: boolean;
  temImagem: boolean;
};
export type ProdutoComArte = { id: string; nome: string; quantidadeArtes: number };

async function json<T>(ctx: APIRequestContext, caminho: string): Promise<T> {
  const resposta = await ctx.get(caminho);
  expect(resposta.status(), caminho).toBe(200);
  return (await resposta.json()) as T;
}

export async function clientePorNome(
  { ctx }: Api,
  empresa: string,
  nome: string,
): Promise<ClienteApi> {
  const pagina = await json<{ itens: ClienteApi[] }>(
    ctx,
    `/v1/empresas/${empresa}/clientes?busca=${encodeURIComponent(nome)}`,
  );
  const cliente = pagina.itens.find((c) => c.nomeExibicao === nome);
  if (!cliente) throw new Error(`Cliente fictício não encontrado: ${nome}`);
  return cliente;
}

export const produtosDoCliente = ({ ctx }: Api, empresa: string, clienteId: string) =>
  json<ProdutoComArte[]>(ctx, `/v1/empresas/${empresa}/clientes/${clienteId}/produtos`);

export const artesDoProduto = (
  { ctx }: Api,
  empresa: string,
  clienteId: string,
  produtoId: string,
) =>
  json<ArteApi[]>(ctx, `/v1/empresas/${empresa}/clientes/${clienteId}/produtos/${produtoId}/artes`);

export async function criarCor({ ctx }: Api, nome: string): Promise<{ id: string; nome: string }> {
  const resposta = await ctx.post('/v1/cores', { data: { nome } });
  expect(resposta.status(), `criar a cor ${nome}`).toBe(201);
  return (await resposta.json()) as { id: string; nome: string };
}

/**
 * Usuário fictício só do cenário, criado pelo painel na ABA (como `admin`) com as permissões informadas. A senha
 * inicial já sai trocada por `senha`, para ele entrar direto. Devolve o id.
 */
export async function criarUsuarioPronto(
  { ctx }: Api,
  dados: { email: string; nome: string; permissoes: string[] },
  senha: string,
): Promise<string> {
  const criado = await ctx.post('/v1/empresas/aba/usuarios', {
    data: {
      nome: dados.nome,
      email: dados.email,
      area: 'producao',
      empresas: ['aba'],
      senha: SENHA,
      permissoes: { aba: dados.permissoes },
    },
  });
  expect(criado.status(), `criar ${dados.email}`).toBe(201);
  const { id } = (await criado.json()) as { id: string };

  const usuario = await apiComo(dados.email);
  try {
    const troca = await usuario.ctx.post('/v1/eu/senha', {
      data: { senhaAtual: SENHA, novaSenha: senha },
    });
    expect(troca.status(), `senha inicial de ${dados.email}`).toBe(204);
  } finally {
    await usuario.fechar();
  }
  return id;
}
