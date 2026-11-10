import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { opcoesNovaArte } from '../src/servidor/artes';
import { API_URL, apiFalsa } from './apoio/api-falsa';

vi.mock('next/headers', () => ({
  cookies: async () => ({ get: () => ({ value: 'acesso-ficticio' }) }),
}));

beforeEach(() => vi.stubEnv('API_URL_INTERNA', API_URL));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const ID = '00000000-0000-4000-8000-00000000000';

describe('opcoesNovaArte', () => {
  it('lê as cores pelo cache do Next (1 h, tag "cores") e o resto sempre da API', async () => {
    const lista = (n: number, nome: string) => () => Response.json([{ id: `${ID}${n}`, nome }]);
    const { chamadas } = apiFalsa({
      'GET /v1/empresas/aba/produtos': lista(1, 'Caixa'),
      'GET /v1/cores': lista(2, '4x0'),
      'GET /v1/maquinas': lista(3, 'Ultra'),
    });

    const opcoes = await opcoesNovaArte('aba');

    expect(opcoes.cores).toEqual([{ id: `${ID}2`, nome: '4x0' }]);
    const init = (caminho: string) =>
      chamadas.find((c) => c.url.pathname === caminho)?.init as RequestInit & {
        next?: unknown;
      };
    expect(init('/v1/cores').next).toEqual({ revalidate: 3600, tags: ['cores'] });
    expect(init('/v1/cores').cache).toBeUndefined();
    for (const caminho of ['/v1/empresas/aba/produtos', '/v1/maquinas']) {
      expect(init(caminho).cache).toBe('no-store');
      expect(init(caminho).next).toBeUndefined();
    }
    expect(new Headers(init('/v1/cores').headers).get('authorization')).toBe(
      'Bearer acesso-ficticio',
    );
  });
});
