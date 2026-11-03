import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { empresas, opContadores, produtos } from '../../src/db/esquema.js';
import { codigoDoErro, criarBancoTeste, limparTabelas } from '../helpers/banco.js';

const VIOLA_CHECK = '23514';
const VIOLA_UNICO = '23505';

const { db, fechar } = criarBancoTeste();
afterAll(() => fechar());
beforeEach(() => limparTabelas(db));

async function empresaId(slug: string) {
  const [linha] = await db.select().from(empresas).where(eq(empresas.slug, slug));
  if (!linha) throw new Error(`empresa ${slug} não semeada`);
  return linha.id;
}

describe('produtos.codigo', () => {
  it('aceita produtos sem código (vários) e com código', async () => {
    const aba = await empresaId('aba');
    await db.insert(produtos).values([
      { empresaId: aba, nome: 'Sem código A' },
      { empresaId: aba, nome: 'Sem código B' },
      { empresaId: aba, nome: 'Com código', codigo: 'XX0001' },
    ]);
    expect(await db.$count(produtos, eq(produtos.empresaId, aba))).toBe(3);
  });

  it('recusa código repetido na mesma empresa, mas aceita em empresas diferentes', async () => {
    const aba = await empresaId('aba');
    const roma = await empresaId('roma');
    await db.insert(produtos).values({ empresaId: aba, nome: 'Produto A', codigo: 'XX0001' });

    expect(
      await codigoDoErro(
        db.insert(produtos).values({ empresaId: aba, nome: 'Produto B', codigo: 'XX0001' }),
      ),
    ).toBe(VIOLA_UNICO);
    await expect(
      db.insert(produtos).values({ empresaId: roma, nome: 'Produto A', codigo: 'XX0001' }),
    ).resolves.toBeDefined();
  });

  it('recusa código em branco', async () => {
    const aba = await empresaId('aba');
    expect(
      await codigoDoErro(
        db.insert(produtos).values({ empresaId: aba, nome: 'Produto', codigo: '   ' }),
      ),
    ).toBe(VIOLA_CHECK);
  });
});

describe('op_contadores', () => {
  it('recusa contador negativo', async () => {
    const aba = await empresaId('aba');
    expect(await codigoDoErro(db.insert(opContadores).values({ empresaId: aba, ultimo: -1 }))).toBe(
      VIOLA_CHECK,
    );
  });

  it('guarda uma linha por empresa', async () => {
    const aba = await empresaId('aba');
    await db.insert(opContadores).values({ empresaId: aba, ultimo: 5 });
    expect(await codigoDoErro(db.insert(opContadores).values({ empresaId: aba, ultimo: 6 }))).toBe(
      VIOLA_UNICO,
    );
  });
});
