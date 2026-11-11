import { PERMISSOES } from '@plataforma/contratos';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { semear } from '../../src/cli/semear-dev.js';
import { listar } from '../../src/usuarios/servico.js';
import { criarBancoTeste, limparTabelas } from '../helpers/banco.js';

const { db, fechar } = criarBancoTeste();
beforeAll(() => limparTabelas(db));
afterAll(async () => {
  await limparTabelas(db);
  await fechar();
});

describe('semear (dados fictícios de desenvolvimento e da E2E)', () => {
  it('cria o admin com todas as permissões e a arte finalista com Artes + adicionar, nas duas empresas', async () => {
    await semear(db);
    // Rodar de novo não duplica nem perde as permissões.
    await semear(db);

    const usuarios = await listar(db);
    expect(usuarios.map(({ email, permissoes }) => ({ email, permissoes }))).toEqual([
      {
        email: 'admin.dev@exemplo.com',
        permissoes: { aba: [...PERMISSOES], roma: [...PERMISSOES] },
      },
      {
        email: 'finalista.dev@exemplo.com',
        permissoes: { aba: ['artes', 'artes.adicionar'], roma: ['artes', 'artes.adicionar'] },
      },
    ]);
  });
});
