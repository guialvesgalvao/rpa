import { STATUS_COMPRA, TIPOS_EVENTO_COMPRA } from '@plataforma/contratos';
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { comprasHistorico, comprasPedidos, empresas, produtos } from '../../src/db/esquema.js';
import { codigoDoErro, criarBancoTeste, limparTabelas } from '../helpers/banco.js';

const VIOLA_CHECK = '23514';
const VIOLA_FK = '23503';

const { db, fechar } = criarBancoTeste();
afterAll(() => fechar());
beforeEach(() => limparTabelas(db));

async function empresaId(slug: string) {
  const [linha] = await db.select().from(empresas).where(eq(empresas.slug, slug));
  if (!linha) throw new Error(`empresa ${slug} não semeada`);
  return linha.id;
}

// Dados sintéticos: um insumo na Roma.
async function cenario() {
  const roma = await empresaId('roma');
  const [insumo] = await db
    .insert(produtos)
    .values({ empresaId: roma, codigo: 'TPP001', nome: 'Tinta Ficticia' })
    .returning();
  return { roma, produtoId: insumo!.id };
}

describe('compras_pedidos', () => {
  it('nasce aberto e guarda a quantidade com 3 decimais', async () => {
    const { roma, produtoId } = await cenario();
    const [pedido] = await db
      .insert(comprasPedidos)
      .values({ empresaId: roma, produtoId, quantidade: 1.125 })
      .returning();
    expect(pedido).toMatchObject({ status: 'aberta', quantidade: 1.125, observacao: null });
  });

  it('os status do CHECK são os do contrato', async () => {
    const { roma, produtoId } = await cenario();
    for (const status of STATUS_COMPRA) {
      await db.insert(comprasPedidos).values({ empresaId: roma, produtoId, quantidade: 1, status });
    }
    expect(
      await codigoDoErro(
        db
          .insert(comprasPedidos)
          .values({ empresaId: roma, produtoId, quantidade: 1, status: 'x' }),
      ),
    ).toBe(VIOLA_CHECK);
  });

  it('recusa quantidade não positiva, observação vazia ou longa e área fora da lista', async () => {
    const { roma, produtoId } = await cenario();
    const base = { empresaId: roma, produtoId, quantidade: 1 };
    for (const valores of [
      { ...base, quantidade: 0 },
      { ...base, observacao: '  ' },
      { ...base, observacao: 'x'.repeat(501) },
      { ...base, areaCriador: 'outra' as never },
    ]) {
      expect(await codigoDoErro(db.insert(comprasPedidos).values(valores))).toBe(VIOLA_CHECK);
    }
  });

  it('o insumo precisa ser da mesma empresa do pedido', async () => {
    const { produtoId } = await cenario();
    const aba = await empresaId('aba');
    expect(
      await codigoDoErro(
        db.insert(comprasPedidos).values({ empresaId: aba, produtoId, quantidade: 1 }),
      ),
    ).toBe(VIOLA_FK);
  });
});

describe('compras_historico', () => {
  it('aceita só os tipos do contrato e ordena os eventos da mesma transação', async () => {
    const { roma, produtoId } = await cenario();
    const [pedido] = await db
      .insert(comprasPedidos)
      .values({ empresaId: roma, produtoId, quantidade: 1 })
      .returning();
    await db.transaction(async (tx) => {
      for (const tipo of TIPOS_EVENTO_COMPRA) {
        await tx.insert(comprasHistorico).values({ pedidoId: pedido!.id, tipo });
      }
    });
    const linhas = await db
      .select({ tipo: comprasHistorico.tipo })
      .from(comprasHistorico)
      .orderBy(comprasHistorico.criadoEm);
    expect(linhas.map((l) => l.tipo)).toEqual([...TIPOS_EVENTO_COMPRA]);
    expect(
      await codigoDoErro(
        db.insert(comprasHistorico).values({ pedidoId: pedido!.id, tipo: 'outro' }),
      ),
    ).toBe(VIOLA_CHECK);
  });

  it('sai junto com o pedido', async () => {
    const { roma, produtoId } = await cenario();
    const [pedido] = await db
      .insert(comprasPedidos)
      .values({ empresaId: roma, produtoId, quantidade: 1 })
      .returning();
    await db.insert(comprasHistorico).values({ pedidoId: pedido!.id, tipo: 'criacao' });
    await db.delete(comprasPedidos).where(eq(comprasPedidos.id, pedido!.id));
    expect(await db.select().from(comprasHistorico)).toEqual([]);
  });
});
