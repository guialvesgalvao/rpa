import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { usuarioDaSessao } from '../src/servidor/eu';
import { API_URL, apiFalsa, respostaEntrar } from './apoio/api-falsa';

const cookiesDaPagina = vi.hoisted(() => new Map<string, string>());

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (nome: string) =>
      cookiesDaPagina.has(nome) ? { value: cookiesDaPagina.get(nome) } : undefined,
  }),
}));

beforeEach(() => {
  vi.stubEnv('API_URL_INTERNA', API_URL);
});

afterEach(() => {
  cookiesDaPagina.clear();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// `redirect()` lança um erro com o destino no `digest`.
const redirecionaPara = (destino: string) =>
  expect.objectContaining({ digest: expect.stringContaining(`;${destino};`) });

describe('usuarioDaSessao', () => {
  it('busca /v1/eu com o acesso do cookie', async () => {
    const { eu } = respostaEntrar(['aba', 'roma']);
    const { chamadas } = apiFalsa({ 'GET /v1/eu': () => Response.json(eu) });
    cookiesDaPagina.set('rpa_acesso', 'acesso-atual');

    await expect(usuarioDaSessao()).resolves.toEqual(eu);
    expect(new Headers(chamadas[0]?.init.headers).get('authorization')).toBe('Bearer acesso-atual');
  });

  it('vai para /entrar sem cookie de acesso, sem chamar a API', async () => {
    const { buscar } = apiFalsa({});

    await expect(usuarioDaSessao()).rejects.toEqual(redirecionaPara('/entrar'));
    expect(buscar).not.toHaveBeenCalled();
  });

  it('vai para /entrar quando a API recusa o token (cookie forjado)', async () => {
    apiFalsa({ 'GET /v1/eu': () => new Response(null, { status: 401 }) });
    cookiesDaPagina.set('rpa_acesso', 'forjado');

    await expect(usuarioDaSessao()).rejects.toEqual(redirecionaPara('/entrar'));
  });

  it('falha (página de erro) quando a API está fora do ar', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    cookiesDaPagina.set('rpa_acesso', 'acesso-atual');

    await expect(usuarioDaSessao()).rejects.toThrow('A API respondeu 502 em /v1/eu.');
  });
});
