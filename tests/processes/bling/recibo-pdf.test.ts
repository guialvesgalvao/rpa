import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium, type Browser, type Page } from 'playwright';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { salvarComoPdf } from '../../../src/processes/bling/guia.js';
import { AJUSTE_RECIBO } from '../../../src/processes/bling/recibo.js';
import { margensHorizontais } from '../../helpers/pdf-layout.js';

// Precisa do Chromium do Playwright (`npm run browsers:install`).
const FIXTURE = path.resolve('tests/fixtures/recibo-layout.html');

let browser: Browser;
let page: Page;

beforeAll(async () => {
  browser = await chromium.launch();
}, 60_000);

afterAll(async () => {
  await browser?.close();
});

beforeEach(async () => {
  page = await browser.newPage();
  await page.setContent(await readFile(FIXTURE, 'utf8'));
});

afterEach(async () => {
  await page.close();
});

describe('PDF do recibo', () => {
  it('sem ajuste, reproduz o recibo encostado à esquerda', async () => {
    const { esquerda, direita } = await margensHorizontais(await salvarComoPdf(page, 'recibo'));
    expect(esquerda).toBeLessThan(direita - 10);
  });

  it('com o ajuste do recibo, sai centralizado na folha', async () => {
    const { esquerda, direita } = await margensHorizontais(
      await salvarComoPdf(page, 'recibo', AJUSTE_RECIBO),
    );
    expect(esquerda).toBeGreaterThan(0);
    expect(direita).toBeGreaterThan(0);
    expect(Math.abs(esquerda - direita)).toBeLessThanOrEqual(3);
  });
});
