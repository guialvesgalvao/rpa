import { PERMISSOES } from '@plataforma/contratos';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { and, eq } from 'drizzle-orm';

import {
  ARTES_REVENDA,
  CLIENTE_REVENDA,
  semear,
  TAREFA_REVENDA,
} from '../../src/cli/semear-dev.js';
import { artes, clientes, tarefasArte } from '../../src/db/esquema.js';
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

  it('semeia uma vez o revendedor da Roma com as artes e as tarefas de clientes finais', async () => {
    await semear(db);
    const [revenda] = await db
      .select()
      .from(clientes)
      .where(eq(clientes.cnpj, CLIENTE_REVENDA.cnpj));
    expect(revenda).toBeDefined();
    const daRevenda = await db.select().from(artes).where(eq(artes.clienteId, revenda!.id));
    expect(daRevenda.map((a) => a.clienteFinal).sort()).toEqual(
      ARTES_REVENDA.map((a) => a.clienteFinal).sort(),
    );
    const tarefas = await db
      .select()
      .from(tarefasArte)
      .where(and(eq(tarefasArte.clienteId, revenda!.id)));
    expect(tarefas.map((t) => [t.status, t.pedidoNumero]).sort()).toEqual([
      ['concluida', '9900'],
      ['nao_iniciada', TAREFA_REVENDA.pedido],
    ]);
  });
});
