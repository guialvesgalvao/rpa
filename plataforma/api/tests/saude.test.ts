import { EsquemaSaude } from '@plataforma/contratos';
import { afterAll, describe, expect, it } from 'vitest';

import { criarApp } from '../src/app.js';

describe('GET /v1/saude', () => {
  const app = criarApp();
  afterAll(() => app.close());

  it('responde 200 com o corpo do contrato', async () => {
    const resposta = await app.inject({ method: 'GET', url: '/v1/saude' });

    expect(resposta.statusCode).toBe(200);
    expect(EsquemaSaude.parse(resposta.json())).toEqual({ status: 'ok' });
  });
});
