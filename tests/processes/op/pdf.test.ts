import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium, type Browser, type Page } from 'playwright';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { gerarPdfOp, salvarPdfOp } from '../../../src/processes/op/pdf.js';
import { LIMITES_PREENCHIMENTO } from '../../../src/processes/op/preenchimento.js';
import { PASSOS_PROCESSO } from '../../../src/processes/op/template.js';
import type { OrdemProducao } from '../../../src/processes/op/tipos.js';
import { resumirPdf } from '../../helpers/pdf-layout.js';

// Precisa do Chromium do Playwright (`npm run browsers:install`).
// A4 em pontos; o Chromium arredonda o tamanho em polegadas (sai ~595,9 pt de largura).
const A4 = { largura: 595.28, altura: 841.89 };
const quaseIgual = (a: number, b: number) => Math.abs(a - b) < 2;

let browser: Browser;
let page: Page;
let png: Buffer;

const op = (extra: Partial<OrdemProducao> = {}): OrdemProducao => ({
  numero: 12,
  data: new Date(2026, 10, 2),
  empresa: 'Roma Embalagens',
  cliente: { nome: 'Cliente Ficticio Ltda', fantasia: 'Pizzaria Ficticia' },
  numeroPedido: '9001',
  previsaoInicial: new Date(2026, 9, 12),
  item: { descricao: 'Caixa Sintetica 35', codigo: 'XX0001', unidade: 'UN', quantidade: 1000 },
  insumos: [
    { nome: 'Papel sintetico A', unidade: 'UN', quantidadePorUnidade: 0.5 },
    { nome: 'Papel sintetico B', unidade: 'UN', quantidadePorUnidade: 0.5 },
    { nome: 'Cola sintetica', unidade: 'KG', quantidadePorUnidade: 0.01 },
  ],
  observacao: 'Fundo prime / colocar tampa e fundo juntos',
  ...extra,
});

beforeAll(async () => {
  browser = await chromium.launch();
  // Imagem sintética da arte: um retângulo colorido gerado pelo próprio Chromium.
  const p = await browser.newPage({ viewport: { width: 300, height: 200 } });
  await p.setContent('<body style="margin:0;background:#c33"></body>');
  png = await p.screenshot({ type: 'png' });
  await p.close();
}, 60_000);

afterAll(async () => {
  await browser?.close();
});

beforeEach(async () => {
  page = await browser.newPage();
});

afterEach(async () => {
  await page.close();
});

describe('PDF da OP', () => {
  it('sem arte: 1 página A4 com cabeçalho, itens, insumos e processo, sem imagem', async () => {
    const pdf = await resumirPdf(await gerarPdfOp(page, op()));
    expect(pdf.paginas).toBe(1);
    expect(quaseIgual(pdf.largura, A4.largura)).toBe(true);
    expect(quaseIgual(pdf.altura, A4.altura)).toBe(true);
    for (const texto of [
      'Ordem de Produção nº 12',
      'Pizzaria Ficticia',
      '9001',
      'Caixa Sintetica 35',
      'XX0001',
      '1.000,00',
      'Papel sintetico A',
      '500,00',
      'Descrição do Processo',
      'Fundo prime / colocar tampa e fundo juntos',
      ...PASSOS_PROCESSO,
    ]) {
      expect(pdf.texto).toContain(texto);
    }
    // "Máquina" só aparece no passo "Verniz Máquina", não no bloco de arte.
    expect(pdf.texto.match(/Máquina/g)).toHaveLength(1);
    expect(pdf.imagens).toBe(0);
  });

  it('com arte: continua em 1 página e traz imagem, máquina e cor', async () => {
    const arte = { imagem: { bytes: png, mime: 'image/png' }, maquinas: ['Favorit'], cor: '4x0' };
    const pdf = await resumirPdf(await gerarPdfOp(page, op({ arte })));
    expect(pdf.paginas).toBe(1);
    expect(pdf.texto.match(/Máquina/g)).toHaveLength(2);
    expect(pdf.texto).toContain('Favorit');
    expect(pdf.texto).toContain('4x0');
    expect(pdf.imagens).toBe(1);
  });

  it('pré-preenchida no limite dos campos, com arte: continua em 1 página', async () => {
    const arte = { imagem: { bytes: png, mime: 'image/png' }, maquinas: ['Favorit'], cor: '4x0' };
    const processo = PASSOS_PROCESSO.map(() => ({
      aplica: 'sim' as const,
      quantidade: '9'.repeat(LIMITES_PREENCHIMENTO.quantidade),
      responsavel: 'M'.repeat(LIMITES_PREENCHIMENTO.responsavel),
      data: new Date(2026, 10, 3),
    }));
    // Pior caso de altura: todas as linhas permitidas, a última longa até o teto de caracteres.
    const curtas = Array.from({ length: LIMITES_PREENCHIMENTO.linhasObservacao - 1 }, () => 'x');
    const longa = 'Observacao sintetica longa. '.repeat(20);
    const observacao = [...curtas, longa].join('\n').slice(0, LIMITES_PREENCHIMENTO.observacao);
    const pdf = await resumirPdf(
      await gerarPdfOp(
        page,
        op({ arte, processo, observacao, dataEntrega: new Date(2026, 10, 20) }),
      ),
    );
    expect(pdf.paginas).toBe(1);
    expect(pdf.texto).toContain('20/11/2026');
    expect(pdf.texto.match(/03\/11\/2026/g)).toHaveLength(PASSOS_PROCESSO.length);
    expect(pdf.imagens).toBe(1);
  });

  it('salva sem sobrescrever um arquivo com o mesmo nome', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'op-pdf-'));
    try {
      const primeiro = await salvarPdfOp(page, op(), dir);
      const segundo = await salvarPdfOp(page, op(), dir);
      expect(path.basename(primeiro)).toBe('OP 12 Pizzaria Ficticia XX0001.pdf');
      expect(path.basename(segundo)).toBe('OP 12 Pizzaria Ficticia XX0001 (2).pdf');
      expect((await readFile(segundo)).subarray(0, 4).toString('latin1')).toBe('%PDF');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
