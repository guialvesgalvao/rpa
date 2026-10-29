// A documentação do Next 16.4 cita `unstable_doesProxyMatch`, mas o pacote só exporta o nome antigo.
import { unstable_doesMiddlewareMatch } from 'next/experimental/testing/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { config, proxy } from '../src/proxy';
import {
  API_URL,
  apiFalsa,
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

describe('matcher do proxy', () => {
  const passa = (url: string) => unstable_doesMiddlewareMatch({ config, nextConfig: {}, url });

  it.each(['/aba/artes', '/roma/artes?pagina=2', '/qualquer'])('guarda a página %s', (url) => {
    expect(passa(url)).toBe(true);
  });

  it.each([
    '/',
    '/api/v1/eu',
    '/api/sessao/entrar',
    '/api',
    '/_next/static/chunks/x.js',
    '/entrar',
    '/entrar?destino=%2Faba',
    '/empresas/aba.png',
    '/favicon.ico',
  ])('deixa %s de fora', (url) => {
    expect(passa(url)).toBe(false);
  });
});

describe('proxy das páginas', () => {
  it('deixa passar com acesso válido, sem chamar a API', async () => {
    const { buscar } = apiFalsa({});

    const resposta = await proxy(
      requisicao('/aba/artes', { cookies: { rpa_acesso: tokenAcesso(Date.now() + 600_000) } }),
    );

    expect(resposta.headers.get('x-middleware-next')).toBe('1');
    expect(buscar).not.toHaveBeenCalled();
  });

  it('manda para /entrar com o destino quando não há sessão', async () => {
    apiFalsa({});

    const resposta = await proxy(requisicao('/roma/artes?pagina=2'));

    expect(resposta.status).toBe(303);
    expect(resposta.headers.get('location')).toBe(
      `${SITE_URL}/entrar?destino=%2Froma%2Fartes%3Fpagina%3D2`,
    );
  });

  it('renova o acesso vencido e repassa os cookies novos à página e ao navegador', async () => {
    const novos = tokensFicticios();
    apiFalsa({ 'POST /v1/auth/renovar': () => Response.json(novos) });

    const resposta = await proxy(
      requisicao('/aba/artes', {
        cookies: { rpa_acesso: tokenAcesso(Date.now() - 1000), rpa_renovacao: 'antiga' },
      }),
    );

    expect(resposta.headers.get('x-middleware-next')).toBe('1');
    expect(resposta.cookies.get('rpa_acesso')?.value).toBe(novos.acesso);
    expect(resposta.cookies.get('rpa_renovacao')?.value).toBe(novos.renovacao);
    // Cabeçalho de requisição sobrescrito: a página já lê o acesso novo.
    expect(resposta.headers.get('x-middleware-request-cookie')).toContain(
      `rpa_acesso=${novos.acesso}`,
    );
  });

  it('manda para /entrar e apaga os cookies quando a renovação é recusada', async () => {
    apiFalsa({ 'POST /v1/auth/renovar': () => new Response(null, { status: 401 }) });

    const resposta = await proxy(
      requisicao('/aba/artes', { cookies: { rpa_renovacao: 'revogada' } }),
    );

    expect(resposta.headers.get('location')).toBe(`${SITE_URL}/entrar?destino=%2Faba%2Fartes`);
    expect(resposta.cookies.get('rpa_renovacao')).toMatchObject({ value: '', maxAge: 0 });
  });

  it('manda para /entrar sem apagar os cookies quando a API está fora do ar', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const resposta = await proxy(requisicao('/aba/artes', { cookies: { rpa_renovacao: 'ok' } }));

    expect(resposta.headers.get('location')).toBe(`${SITE_URL}/entrar?destino=%2Faba%2Fartes`);
    expect(resposta.cookies.get('rpa_renovacao')).toBeUndefined();
  });
});
