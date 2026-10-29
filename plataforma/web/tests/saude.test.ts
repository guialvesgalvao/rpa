import { EsquemaSaude } from '@plataforma/contratos';
import { describe, expect, it } from 'vitest';

import { GET } from '../src/app/api/saude/route';

describe('GET /api/saude', () => {
  it('responde 200 com o corpo do contrato', async () => {
    const resposta = GET();

    expect(resposta.status).toBe(200);
    expect(EsquemaSaude.parse(await resposta.json())).toEqual({ status: 'ok' });
  });
});
