import { EsquemaErro, EsquemaSaude } from '@plataforma/contratos';
import { afterAll, describe, expect, it } from 'vitest';

import { criarAppTeste } from './helpers/app.js';
import { criarBancoTeste } from './helpers/banco.js';

describe('GET /v1/saude', () => {
  const { db, fechar } = criarBancoTeste();
  const { app } = criarAppTeste(db);
  afterAll(async () => {
    await app.close();
    await fechar();
  });

  it('responde 200 com o corpo do contrato', async () => {
    const resposta = await app.inject({ method: 'GET', url: '/v1/saude' });

    expect(resposta.statusCode).toBe(200);
    expect(EsquemaSaude.parse(resposta.json())).toEqual({ status: 'ok' });
  });

  it('responde 404 de rota inexistente no formato de erro do contrato', async () => {
    const resposta = await app.inject({ method: 'GET', url: '/v1/nada' });

    expect(resposta.statusCode).toBe(404);
    expect(EsquemaErro.parse(resposta.json()).erro.codigo).toBe('nao_encontrado');
  });
});
