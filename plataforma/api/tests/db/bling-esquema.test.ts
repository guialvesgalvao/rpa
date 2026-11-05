import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { gerarCnpj } from '../../src/cli/semear-dev.js';
import { blingSincronizacoes, clientes, empresas, produtos } from '../../src/db/esquema.js';
import { codigoDoErro, criarBancoTeste, limparTabelas } from '../helpers/banco.js';

const VIOLA_UNICO = '23505';
const VIOLA_FK = '23503';
// Acima de 2³¹, como os ids reais do Bling.
const ID_GRANDE = 16_000_000_001;

const { db, fechar } = criarBancoTeste();
afterAll(() => fechar());
beforeEach(() => limparTabelas(db));

async function empresaId(slug: string) {
  const [linha] = await db.select().from(empresas).where(eq(empresas.slug, slug));
  if (!linha) throw new Error(`empresa ${slug} não semeada`);
  return linha.id;
}

let contadorCnpj = 0;
const cliente = (empresa: string, idBling: number | null) => ({
  empresaId: empresa,
  razaoSocial: 'Cliente Sintético Ltda',
  cnpj: gerarCnpj(++contadorCnpj),
  idBling,
});

describe('clientes.id_bling', () => {
  it('nasce nulo, com a marca de inativo também nula', async () => {
    const aba = await empresaId('aba');
    const [linha] = await db.insert(clientes).values(cliente(aba, null)).returning();
    expect(linha?.idBling).toBeNull();
    expect(linha?.inativoNoBlingEm).toBeNull();
  });

  it('recusa id repetido na mesma empresa, mas aceita em outra e vários nulos', async () => {
    const aba = await empresaId('aba');
    const roma = await empresaId('roma');
    await db.insert(clientes).values([cliente(aba, 101), cliente(aba, null), cliente(aba, null)]);

    expect(await codigoDoErro(db.insert(clientes).values(cliente(aba, 101)))).toBe(VIOLA_UNICO);
    await expect(db.insert(clientes).values(cliente(roma, 101))).resolves.toBeDefined();
  });

  it('grava e lê um id acima de 2³¹ sem perder precisão', async () => {
    const aba = await empresaId('aba');
    const [criado] = await db.insert(clientes).values(cliente(aba, ID_GRANDE)).returning();
    const [lido] = await db
      .select({ idBling: clientes.idBling })
      .from(clientes)
      .where(eq(clientes.id, criado?.id ?? ''));
    expect(lido?.idBling).toBe(ID_GRANDE);
  });
});

describe('produtos.id_bling', () => {
  it('recusa id repetido na mesma empresa, mas aceita em outra', async () => {
    const aba = await empresaId('aba');
    const roma = await empresaId('roma');
    await db.insert(produtos).values({ empresaId: aba, nome: 'Produto A', idBling: 202 });

    expect(
      await codigoDoErro(
        db.insert(produtos).values({ empresaId: aba, nome: 'Produto B', idBling: 202 }),
      ),
    ).toBe(VIOLA_UNICO);
    await expect(
      db.insert(produtos).values({ empresaId: roma, nome: 'Produto A', idBling: 202 }),
    ).resolves.toBeDefined();
  });

  it('grava e lê um id acima de 2³¹ sem perder precisão', async () => {
    const aba = await empresaId('aba');
    await db.insert(produtos).values({ empresaId: aba, nome: 'Produto', idBling: ID_GRANDE });
    const [lido] = await db
      .select({ idBling: produtos.idBling })
      .from(produtos)
      .where(eq(produtos.empresaId, aba));
    expect(lido?.idBling).toBe(ID_GRANDE);
  });
});

describe('bling_sincronizacoes', () => {
  it('guarda uma linha por empresa, com os padrões', async () => {
    const aba = await empresaId('aba');
    const [linha] = await db.insert(blingSincronizacoes).values({ empresaId: aba }).returning();
    expect(linha).toMatchObject({
      incrementalDesde: null,
      ultimaCompletaEm: null,
      emExecucaoDesde: null,
      ultimoResultado: null,
    });
    expect(linha?.atualizadoEm).toBeInstanceOf(Date);
    expect(await codigoDoErro(db.insert(blingSincronizacoes).values({ empresaId: aba }))).toBe(
      VIOLA_UNICO,
    );
  });

  it('guarda o resultado em JSON e recusa empresa inexistente', async () => {
    const aba = await empresaId('aba');
    const resultado = { situacao: 'concluida', produtos: 3, avisos: [] };
    await db.insert(blingSincronizacoes).values({ empresaId: aba, ultimoResultado: resultado });
    const [lido] = await db.select().from(blingSincronizacoes);
    expect(lido?.ultimoResultado).toEqual(resultado);

    expect(
      await codigoDoErro(db.insert(blingSincronizacoes).values({ empresaId: crypto.randomUUID() })),
    ).toBe(VIOLA_FK);
  });
});
