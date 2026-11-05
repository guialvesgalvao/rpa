import type { ResultadoSincronizacaoBling } from '@plataforma/contratos';
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { criarEstadoSincronizacao } from '../../src/bling/estado.js';
import { blingSincronizacoes, empresas } from '../../src/db/esquema.js';
import { criarRelogioFalso } from '../helpers/app.js';
import { criarBancoTeste, limparTabelas } from '../helpers/banco.js';

const { db, fechar } = criarBancoTeste();
afterAll(() => fechar());

const HORA = 60 * 60 * 1000;

let relogio: ReturnType<typeof criarRelogioFalso>;
let estado: ReturnType<typeof criarEstadoSincronizacao>;
let roma: string;
let aba: string;
beforeEach(async () => {
  await limparTabelas(db);
  relogio = criarRelogioFalso();
  estado = criarEstadoSincronizacao({ db, relogio: relogio.agora });
  roma = await empresaId('roma');
  aba = await empresaId('aba');
});

async function empresaId(slug: string) {
  const [linha] = await db.select().from(empresas).where(eq(empresas.slug, slug));
  if (!linha) throw new Error(`empresa ${slug} não semeada`);
  return linha.id;
}

const resultado = (
  dados: Partial<ResultadoSincronizacaoBling> = {},
): ResultadoSincronizacaoBling => ({
  tipo: 'incremental',
  origem: 'agendador',
  situacao: 'concluida',
  iniciadaEm: '2026-01-05T12:00:00.000Z',
  concluidaEm: '2026-01-05T12:00:30.000Z',
  produtos: 1,
  clientes: 2,
  avisos: [],
  ...dados,
});

describe('estado da sincronização', () => {
  it('sem linha, devolve tudo nulo', async () => {
    expect(await estado.ler(roma)).toEqual({
      incrementalDesde: null,
      ultimaCompletaEm: null,
      emExecucaoDesde: null,
      ultimoResultado: null,
    });
  });

  it('a completa bem-sucedida avança a janela e a última completa', async () => {
    const completa = resultado({ tipo: 'completa' });
    await estado.registrar(roma, completa);

    expect(await estado.ler(roma)).toEqual({
      incrementalDesde: new Date(completa.iniciadaEm),
      ultimaCompletaEm: new Date(completa.iniciadaEm),
      emExecucaoDesde: null,
      ultimoResultado: completa,
    });
    expect((await estado.ler(aba)).ultimoResultado).toBeNull();
  });

  it('o incremental bem-sucedido avança só a janela', async () => {
    await estado.registrar(roma, resultado({ tipo: 'completa' }));
    const incremental = resultado({ iniciadaEm: '2026-01-05T12:15:00.000Z' });
    await estado.registrar(roma, incremental);

    expect(await estado.ler(roma)).toMatchObject({
      incrementalDesde: new Date('2026-01-05T12:15:00.000Z'),
      ultimaCompletaEm: new Date('2026-01-05T12:00:00.000Z'),
      ultimoResultado: incremental,
    });
  });

  it.each(['falhou', 'nao_conectado'] as const)(
    '%s grava só o resultado, sem avançar a janela',
    async (situacao) => {
      await estado.registrar(roma, resultado({ tipo: 'completa' }));
      const falha = resultado({
        tipo: 'completa',
        situacao,
        iniciadaEm: '2026-01-06T12:00:00.000Z',
        produtos: 0,
        clientes: 0,
        erro: { codigo: 'bling_indisponivel', mensagem: 'O Bling não respondeu.' },
      });
      await estado.registrar(roma, falha);

      expect(await estado.ler(roma)).toMatchObject({
        incrementalDesde: new Date('2026-01-05T12:00:00.000Z'),
        ultimaCompletaEm: new Date('2026-01-05T12:00:00.000Z'),
        ultimoResultado: falha,
      });
    },
  );

  it('um resultado fora do contrato no banco é lido como nulo', async () => {
    await db.insert(blingSincronizacoes).values({ empresaId: roma, ultimoResultado: { x: 1 } });
    expect((await estado.ler(roma)).ultimoResultado).toBeNull();
  });
});

describe('lease do agendador', () => {
  it('é exclusivo, volta depois de liberado e é retomado depois da validade', async () => {
    expect(await estado.tomarLease(roma, HORA)).toBe(true);
    expect((await estado.ler(roma)).emExecucaoDesde).toEqual(relogio.agora());
    expect(await estado.tomarLease(roma, HORA)).toBe(false);
    // Outra empresa tem o próprio lease.
    expect(await estado.tomarLease(aba, HORA)).toBe(true);

    await estado.liberarLease(roma);
    expect(await estado.tomarLease(roma, HORA)).toBe(true);

    relogio.avancar(HORA - 1000);
    expect(await estado.tomarLease(roma, HORA)).toBe(false);
    relogio.avancar(2000);
    expect(await estado.tomarLease(roma, HORA)).toBe(true);
  });

  it('não apaga o resultado nem a janela gravados', async () => {
    const completa = resultado({ tipo: 'completa' });
    await estado.registrar(roma, completa);
    await estado.tomarLease(roma, HORA);
    await estado.liberarLease(roma);
    expect(await estado.ler(roma)).toMatchObject({
      ultimoResultado: completa,
      ultimaCompletaEm: new Date(completa.iniciadaEm),
      emExecucaoDesde: null,
    });
  });
});
