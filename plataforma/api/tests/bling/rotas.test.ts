import { randomBytes } from 'node:crypto';

import {
  EsquemaConexaoBling,
  EsquemaErro,
  EsquemaEstadoSincronizacaoBling,
  EsquemaRespostaEntrar,
} from '@plataforma/contratos';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { criarApp } from '../../src/app.js';
import { gerarCnpj } from '../../src/cli/semear-dev.js';
import { blingConexoes, clientes, empresas, produtos } from '../../src/db/esquema.js';
import { criarUsuario } from '../../src/usuarios/servico.js';
import { SEGREDO_TESTE } from '../helpers/app.js';
import { criarBancoTeste, limparTabelas } from '../helpers/banco.js';

// Credenciais, tokens e dados fictícios.
const SENHA = 'senha-ficticia-123';
const CODE = 'codigo-ficticio-do-bling';
const ACESSO_BLING = 'acesso-bling-ficticio';
const RENOVACAO_BLING = 'renovacao-bling-ficticia';
const CNPJ_FICTICIO = gerarCnpj(900);
const CONFIG = {
  clientId: 'client-id-ficticio',
  clientSecret: 'client-secret-ficticio',
  redirectUri: 'http://localhost:3001/v1/bling/oauth/retorno',
  chaveTokens: randomBytes(32).toString('base64'),
};

const { db, fechar } = criarBancoTeste();
afterAll(() => fechar());

const json = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { 'content-type': 'application/json' } });

// Bling falso: 2 produtos, tipo Cliente e 1 contato ativo com detalhe.
function blingFalso() {
  let liberarDetalhe: () => void = () => {};
  const detalheLiberado = { valor: true };
  const fake = vi.fn(async (entrada: string | URL | Request, init?: RequestInit) => {
    const caminho = new URL(String(entrada)).pathname.replace('/Api/v3', '');
    if (caminho === '/oauth/token')
      return json({
        access_token: ACESSO_BLING,
        refresh_token: RENOVACAO_BLING,
        expires_in: 21_600,
      });
    if (caminho === '/produtos')
      return json({
        data: [1, 2].map((id) => ({ id, nome: `Produto ${id}`, codigo: `SKU${id}`, formato: 'S' })),
      });
    if (caminho === '/contatos/tipos') return json({ data: [{ id: 5, descricao: 'Cliente' }] });
    if (caminho === '/contatos')
      return json({ data: [{ id: 100, nome: 'Empresa Fictícia', situacao: 'A' }] });
    // Detalhe preso até o teste liberar, ou até a chamada ser cancelada (como o `fetch` real).
    if (!detalheLiberado.valor)
      await new Promise<void>((resolver, rejeitar) => {
        liberarDetalhe = resolver;
        init?.signal?.addEventListener('abort', () => rejeitar(init.signal?.reason));
      });
    return json({
      data: {
        id: 100,
        nome: 'Empresa Fictícia',
        tipo: 'J',
        fantasia: 'Fictícia',
        numeroDocumento: CNPJ_FICTICIO,
      },
    });
  });
  return {
    fetch: fake as unknown as typeof fetch,
    chamadas: fake.mock.calls,
    segurarDetalhe: () => (detalheLiberado.valor = false),
    liberarDetalhe: () => {
      detalheLiberado.valor = true;
      liberarDetalhe();
    },
  };
}

let app: FastifyInstance;
let bling: ReturnType<typeof blingFalso>;
let logs: string[];

function montarApp(comBling = true) {
  logs = [];
  bling = blingFalso();
  return criarApp({
    db,
    jwtSegredo: SEGREDO_TESTE,
    logger: { level: 'trace', stream: { write: (linha: string) => logs.push(linha) } },
    ...(comBling && {
      bling: { ...CONFIG, fetch: bling.fetch, esperar: async () => {} },
    }),
  });
}

async function entrar(
  email: string,
  perfil: 'admin' | 'arte_finalista',
  empresasDoUsuario: string[],
) {
  await criarUsuario(db, {
    email,
    nome: 'Usuária Teste',
    perfil,
    senha: SENHA,
    empresas: empresasDoUsuario,
  });
  const resposta = await app.inject({
    method: 'POST',
    url: '/v1/auth/entrar',
    payload: { email, senha: SENHA, origem: 'desktop' },
  });
  return EsquemaRespostaEntrar.parse(resposta.json()).acesso;
}

const chamar = (
  metodo: 'GET' | 'POST',
  rota: 'conexao' | 'sincronizacao',
  token: string | null,
  empresa = 'roma',
) =>
  app.inject({
    method: metodo,
    url: `/v1/empresas/${empresa}/bling/${rota}`,
    ...(token && { headers: { authorization: `Bearer ${token}` } }),
  });

const codigoErro = (resposta: { json: () => unknown }) =>
  EsquemaErro.parse(resposta.json()).erro.codigo;

async function conectar(token: string) {
  const { urlAutorizacao } = EsquemaConexaoBling.parse(
    (await chamar('POST', 'conexao', token)).json(),
  );
  const state = new URL(urlAutorizacao).searchParams.get('state') ?? '';
  return app.inject({
    method: 'GET',
    url: `/v1/bling/oauth/retorno?code=${CODE}&state=${encodeURIComponent(state)}`,
  });
}

async function estadoAte(token: string, situacao: string) {
  return vi.waitFor(async () => {
    const estado = EsquemaEstadoSincronizacaoBling.parse(
      (await chamar('GET', 'sincronizacao', token)).json(),
    );
    expect(estado.situacao).toBe(situacao);
    return estado;
  });
}

let admin: string;
beforeEach(async () => {
  await limparTabelas(db);
  app = montarApp();
  admin = await entrar('admin@exemplo.com', 'admin', ['aba', 'roma']);
});
afterEach(() => app.close());

describe('guardas', () => {
  it('sem token → 401', async () => {
    for (const metodo of ['GET', 'POST'] as const)
      expect((await chamar(metodo, 'sincronizacao', null)).statusCode).toBe(401);
    expect((await chamar('POST', 'conexao', null)).statusCode).toBe(401);
  });

  it('arte finalista → 403', async () => {
    const arte = await entrar('arte@exemplo.com', 'arte_finalista', ['roma']);
    expect((await chamar('POST', 'sincronizacao', arte)).statusCode).toBe(403);
    expect((await chamar('POST', 'conexao', arte)).statusCode).toBe(403);
  });

  it('empresa fora da lista de sincronização (aba) → 403', async () => {
    const resposta = await chamar('POST', 'sincronizacao', admin, 'aba');
    expect(resposta.statusCode).toBe(403);
    expect(codigoErro(resposta)).toBe('sincronizacao_indisponivel');
    expect((await chamar('POST', 'conexao', admin, 'aba')).statusCode).toBe(403);
  });

  it('admin sem acesso à Roma → 403', async () => {
    const soAba = await entrar('aba@exemplo.com', 'admin', ['aba']);
    expect((await chamar('POST', 'sincronizacao', soAba)).statusCode).toBe(403);
  });
});

describe('sem configuração do Bling', () => {
  it('as rotas existem e respondem 503', async () => {
    await app.close();
    app = montarApp(false);
    for (const [metodo, rota] of [
      ['POST', 'conexao'],
      ['POST', 'sincronizacao'],
      ['GET', 'sincronizacao'],
    ] as const) {
      const resposta = await chamar(metodo, rota, admin);
      expect(resposta.statusCode).toBe(503);
      expect(codigoErro(resposta)).toBe('bling_nao_configurado');
    }
    const retorno = await app.inject({
      method: 'GET',
      url: `/v1/bling/oauth/retorno?code=x&state=y`,
    });
    expect(retorno.statusCode).toBe(503);
  });
});

describe('conexão e retorno OAuth', () => {
  it('sem conexão, a sincronização responde 409 e a conexão devolve a URL do Bling com state', async () => {
    const resposta = await chamar('POST', 'sincronizacao', admin);
    expect(resposta.statusCode).toBe(409);
    expect(codigoErro(resposta)).toBe('bling_nao_conectado');

    const conexao = await chamar('POST', 'conexao', admin);
    expect(conexao.statusCode).toBe(200);
    const url = new URL(EsquemaConexaoBling.parse(conexao.json()).urlAutorizacao);
    expect(url.host).toBe('www.bling.com.br');
    expect(url.searchParams.get('state')).toBeTruthy();
    expect(bling.chamadas).toHaveLength(0);
  });

  it('retorno com state válido grava a conexão', async () => {
    const retorno = await conectar(admin);

    expect(retorno.statusCode).toBe(200);
    expect(retorno.headers['content-type']).toMatch(/text\/html/);
    expect(retorno.body).toContain('Bling conectado');
    const [roma] = await db.select().from(empresas).where(eq(empresas.slug, 'roma'));
    expect(await db.$count(blingConexoes, eq(blingConexoes.empresaId, roma!.id))).toBe(1);
  });

  it('retorno com state inválido ou sem parâmetros não grava nada', async () => {
    const invalido = await app.inject({
      method: 'GET',
      url: `/v1/bling/oauth/retorno?code=${CODE}&state=nao-e-jwt`,
    });
    expect(invalido.statusCode).toBe(400);
    expect(invalido.body).not.toMatch(/Erro|stack|jwt/i);
    const semParametros = await app.inject({
      method: 'GET',
      url: '/v1/bling/oauth/retorno?error=access_denied',
    });
    expect(semParametros.statusCode).toBe(400);
    expect(await db.$count(blingConexoes)).toBe(0);
    expect(bling.chamadas).toHaveLength(0);
  });
});

describe('sincronização', () => {
  it('POST → 202 e o GET chega a concluída, com as linhas gravadas no banco', async () => {
    await conectar(admin);

    const inicio = await chamar('POST', 'sincronizacao', admin);
    expect(inicio.statusCode).toBe(202);
    expect(EsquemaEstadoSincronizacaoBling.parse(inicio.json()).situacao).toBe('em_andamento');

    const estado = await estadoAte(admin, 'concluida');
    expect(estado).toMatchObject({
      resumo: { empresa: 'roma', produtos: 2, clientes: 1, avisos: [] },
    });
    const [roma] = await db.select().from(empresas).where(eq(empresas.slug, 'roma'));
    const gravados = await db
      .select({ idBling: produtos.idBling, codigo: produtos.codigo })
      .from(produtos)
      .where(eq(produtos.empresaId, roma!.id));
    expect(gravados.sort((a, b) => (a.idBling ?? 0) - (b.idBling ?? 0))).toEqual([
      { idBling: 1, codigo: 'SKU1' },
      { idBling: 2, codigo: 'SKU2' },
    ]);
    expect(
      await db
        .select({ idBling: clientes.idBling, cnpj: clientes.cnpj, nome: clientes.nomeExibicao })
        .from(clientes)
        .where(eq(clientes.empresaId, roma!.id)),
    ).toEqual([{ idBling: 100, cnpj: CNPJ_FICTICIO, nome: 'Fictícia' }]);
  });

  it('segundo POST durante o job → 202 com o mesmo iniciadaEm, sem nova leitura', async () => {
    await conectar(admin);
    bling.segurarDetalhe();

    const primeiro = EsquemaEstadoSincronizacaoBling.parse(
      (await chamar('POST', 'sincronizacao', admin)).json(),
    );
    await vi.waitFor(() => expect(bling.chamadas.length).toBeGreaterThanOrEqual(5));
    const segundo = await chamar('POST', 'sincronizacao', admin);
    expect(segundo.statusCode).toBe(202);
    expect(primeiro).toMatchObject({ situacao: 'em_andamento' });
    expect(segundo.json()).toMatchObject({
      situacao: 'em_andamento',
      iniciadaEm: (primeiro as { iniciadaEm: string }).iniciadaEm,
    });

    bling.liberarDetalhe();
    await estadoAte(admin, 'concluida');
    const produtos = bling.chamadas.filter(([url]) => String(url).includes('/produtos'));
    expect(produtos).toHaveLength(1);
  });

  it('GET antes de qualquer sincronização → ociosa', async () => {
    expect((await chamar('GET', 'sincronizacao', admin)).json()).toEqual({ situacao: 'ociosa' });
  });

  it('fechar a API durante o job aborta a sincronização', async () => {
    await conectar(admin);
    bling.segurarDetalhe();
    await chamar('POST', 'sincronizacao', admin);
    await vi.waitFor(() => expect(bling.chamadas.length).toBeGreaterThanOrEqual(5));

    // Sem liberar o detalhe: o fechamento cancela a chamada em andamento em vez de esperá-la.
    await app.close();
    expect(await db.$count(produtos)).toBe(0);
    expect(await db.$count(clientes)).toBe(0);
  });
});

describe('logs', () => {
  it('não registram tokens, code nem dados do Bling', async () => {
    await conectar(admin);
    await chamar('POST', 'sincronizacao', admin);
    await estadoAte(admin, 'concluida');

    const tudo = logs.join('\n');
    expect(tudo.length).toBeGreaterThan(0);
    for (const segredo of [
      CODE,
      ACESSO_BLING,
      RENOVACAO_BLING,
      CONFIG.clientSecret,
      'Empresa Fictícia',
      CNPJ_FICTICIO,
    ])
      expect(tudo).not.toContain(segredo);
    expect(tudo).not.toContain('oauth/retorno');
  });
});
