import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DELETE, GET, PATCH, POST } from '../src/app/api/v1/[...caminho]/route';
import {
  API_URL,
  apiFalsa,
  corpoJson,
  requisicao,
  SITE_URL,
  tokenAcesso,
  tokensFicticios,
} from './apoio/api-falsa';

beforeEach(() => {
  vi.stubEnv('API_URL_INTERNA', API_URL);
  vi.stubEnv('SITE_URL', SITE_URL);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const acessoValido = () => tokenAcesso(Date.now() + 10 * 60 * 1000);

describe('/api/v1/[...caminho]', () => {
  it('repassa o GET com o token do cookie e devolve status e corpo da API', async () => {
    const acesso = acessoValido();
    const { chamadas } = apiFalsa({
      'GET /v1/eu': () => Response.json({ nome: 'Pessoa Teste' }, { status: 200 }),
    });

    const resposta = await GET(
      requisicao('/api/v1/eu', {
        cookies: { rpa_acesso: acesso, rpa_renovacao: 'renovacao' },
        cabecalhos: {
          authorization: 'Bearer forjado',
          'x-extra': '1',
          'content-type': 'text/plain',
        },
      }),
    );

    expect(resposta.status).toBe(200);
    expect(await resposta.json()).toEqual({ nome: 'Pessoa Teste' });
    expect(chamadas[0]?.url.href).toBe(`${API_URL}/v1/eu`);
    const enviados = new Headers(chamadas[0]?.init.headers);
    expect([...enviados.keys()].sort()).toEqual(['authorization', 'content-type']);
    expect(enviados.get('authorization')).toBe(`Bearer ${acesso}`);
    expect(resposta.cookies.get('rpa_acesso')).toBeUndefined();
  });

  it('mantém a query string e devolve erros da API como vieram', async () => {
    const { chamadas } = apiFalsa({
      'GET /v1/empresas/aba/artes': () =>
        Response.json({ erro: { codigo: 'empresa_proibida', mensagem: 'x' } }, { status: 403 }),
    });

    const resposta = await GET(
      requisicao('/api/v1/empresas/aba/artes?pagina=2', {
        cookies: { rpa_acesso: acessoValido() },
      }),
    );

    expect(resposta.status).toBe(403);
    expect(await resposta.json()).toEqual({ erro: { codigo: 'empresa_proibida', mensagem: 'x' } });
    expect(chamadas[0]?.url.search).toBe('?pagina=2');
  });

  it('repassa o corpo do POST em streaming, com o Content-Type', async () => {
    const { chamadas } = apiFalsa({
      'POST /v1/cores': async ({ init }) =>
        Response.json(await new Response(init.body).json(), { status: 201 }),
    });

    const resposta = await POST(
      requisicao('/api/v1/cores', {
        metodo: 'POST',
        origem: SITE_URL,
        cookies: { rpa_acesso: acessoValido() },
        cabecalhos: { 'content-type': 'application/json' },
        corpo: JSON.stringify({ nome: 'Azul' }),
      }),
    );

    expect(resposta.status).toBe(201);
    expect(await resposta.json()).toEqual({ nome: 'Azul' });
    expect(chamadas[0]?.init.body).toBeInstanceOf(ReadableStream);
    expect(chamadas[0]?.init.duplex).toBe('half');
    expect(new Headers(chamadas[0]?.init.headers).get('content-type')).toBe('application/json');
  });

  it.each([
    ['/api/v1/auth/entrar'],
    ['/api/v1/auth/renovar'],
    ['/api/v1/saude'],
    ['/api/v1/empresas/aba/%2e%2e/%2e%2e/auth/sair'],
    ['/api/v1/empresas/aba%2f..%2f..%2fauth%2fsair'],
  ])('responde 404 sem chamar a API para o prefixo proibido %s', async (caminho) => {
    const { buscar } = apiFalsa({});

    const resposta = await GET(requisicao(caminho, { cookies: { rpa_acesso: acessoValido() } }));

    expect(resposta.status).toBe(404);
    expect(buscar).not.toHaveBeenCalled();
  });

  it.each([
    ['POST', POST],
    ['PATCH', PATCH],
    ['DELETE', DELETE],
  ] as const)('responde 403 ao %s de outra origem ou sem Origin', async (metodo, handler) => {
    const { buscar } = apiFalsa({});

    for (const origem of ['https://mal.exemplo', undefined]) {
      const resposta = await handler(
        requisicao('/api/v1/cores/1', {
          metodo,
          origem,
          cookies: { rpa_acesso: acessoValido() },
          ...(metodo !== 'DELETE' && { corpo: '{}' }),
        }),
      );
      expect(resposta.status).toBe(403);
    }
    expect(buscar).not.toHaveBeenCalled();
  });

  it('renova o acesso vencido de forma transparente e grava os cookies novos', async () => {
    const novos = tokensFicticios();
    const { chamadas } = apiFalsa({
      'POST /v1/auth/renovar': () => Response.json(novos),
      'GET /v1/eu': () => Response.json({ ok: true }),
    });

    const resposta = await GET(
      requisicao('/api/v1/eu', {
        cookies: {
          rpa_acesso: tokenAcesso(Date.now() - 1000),
          rpa_renovacao: 'renovacao-antiga',
        },
      }),
    );

    expect(resposta.status).toBe(200);
    expect(corpoJson(chamadas[0])).toEqual({ renovacao: 'renovacao-antiga' });
    expect(new Headers(chamadas[1]?.init.headers).get('authorization')).toBe(
      `Bearer ${novos.acesso}`,
    );
    expect(resposta.cookies.get('rpa_acesso')?.value).toBe(novos.acesso);
    expect(resposta.cookies.get('rpa_renovacao')?.value).toBe(novos.renovacao);
  });

  it('responde 401 e apaga os cookies quando a API recusa a renovação', async () => {
    const { chamadas } = apiFalsa({
      'POST /v1/auth/renovar': () => new Response(null, { status: 401 }),
    });

    const resposta = await GET(
      requisicao('/api/v1/eu', { cookies: { rpa_renovacao: 'renovacao-revogada' } }),
    );

    expect(resposta.status).toBe(401);
    expect((await resposta.json()).erro.codigo).toBe('nao_autenticado');
    expect(chamadas).toHaveLength(1);
    expect(resposta.cookies.get('rpa_renovacao')).toMatchObject({ value: '', maxAge: 0 });
  });

  it('responde 401 sem chamar a API quando não há sessão', async () => {
    const { buscar } = apiFalsa({});

    const resposta = await GET(requisicao('/api/v1/eu'));

    expect(resposta.status).toBe(401);
    expect(buscar).not.toHaveBeenCalled();
  });

  it('responde 502 e mantém os cookies quando a API está fora do ar', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const semRenovar = await GET(
      requisicao('/api/v1/eu', { cookies: { rpa_acesso: acessoValido() } }),
    );
    const renovando = await GET(
      requisicao('/api/v1/eu', { cookies: { rpa_renovacao: 'renovacao' } }),
    );

    expect(semRenovar.status).toBe(502);
    expect(renovando.status).toBe(502);
    expect(renovando.cookies.get('rpa_renovacao')).toBeUndefined();
  });
});
