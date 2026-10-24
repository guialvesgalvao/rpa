import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  caminhoLivre,
  formatarData,
  formatarParcelas,
  nomeBoleto,
  nomeNf,
  nomeRecibo,
} from '../../../src/processes/bling/nomes.js';

const data = (dia: number, mes: number, ano: number): Date => new Date(ano, mes - 1, dia);

const quatroParcelas = [
  data(25, 10, 2026),
  data(1, 11, 2026),
  data(8, 11, 2026),
  data(15, 11, 2026),
];

describe('formatarData', () => {
  it('DD MM AA com zeros à esquerda', () => {
    expect(formatarData(data(5, 3, 2027))).toBe('05 03 27');
  });

  it('usa a data local mesmo perto da meia-noite', () => {
    expect(formatarData(new Date(2026, 9, 25, 23, 59))).toBe('25 10 26');
    expect(formatarData(new Date(2026, 9, 25, 0, 1))).toBe('25 10 26');
  });
});

describe('formatarParcelas', () => {
  it('uma parcela', () => {
    expect(formatarParcelas([data(25, 10, 2026)])).toBe('25 10 26');
  });

  it('quatro parcelas, ano só no fim', () => {
    expect(formatarParcelas(quatroParcelas)).toBe('25 10 - 01 11 - 08 11 - 15 11 26');
  });

  it('virada de ano usa o ano da última parcela', () => {
    expect(formatarParcelas([data(20, 12, 2026), data(3, 1, 2027)])).toBe('20 12 - 03 01 27');
  });

  it('lista vazia é erro', () => {
    expect(() => formatarParcelas([])).toThrow('Pedido sem parcelas');
  });
});

describe('nomes de arquivo', () => {
  it('boleto', () => {
    expect(nomeBoleto('Loja Exemplo', data(25, 10, 2026))).toBe('Boleto Loja Exemplo 25 10 26.pdf');
  });

  it('recibo', () => {
    expect(nomeRecibo('Loja Exemplo', quatroParcelas)).toBe(
      'Recibo Loja Exemplo 25 10 - 01 11 - 08 11 - 15 11 26.pdf',
    );
  });

  it('nota fiscal', () => {
    expect(nomeNf('1234', 'Loja Exemplo', [data(25, 10, 2026)])).toBe(
      'NF 1234 Loja Exemplo 25 10 26.pdf',
    );
  });

  it('remove caracteres inválidos do cliente', () => {
    expect(nomeBoleto('A/B: "C"*?', data(25, 10, 2026))).toBe('Boleto A_B_ _C___ 25 10 26.pdf');
  });
});

describe('caminhoLivre', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'rpa-nomes-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('usa o nome quando está livre', async () => {
    expect(await caminhoLivre(dir, 'Recibo X 25 10 26.pdf')).toBe(
      path.join(dir, 'Recibo X 25 10 26.pdf'),
    );
  });

  it('acrescenta (2), (3)… sem sobrescrever', async () => {
    await writeFile(path.join(dir, 'Recibo X 25 10 26.pdf'), '');
    expect(await caminhoLivre(dir, 'Recibo X 25 10 26.pdf')).toBe(
      path.join(dir, 'Recibo X 25 10 26 (2).pdf'),
    );
    await writeFile(path.join(dir, 'Recibo X 25 10 26 (2).pdf'), '');
    expect(await caminhoLivre(dir, 'Recibo X 25 10 26.pdf')).toBe(
      path.join(dir, 'Recibo X 25 10 26 (3).pdf'),
    );
  });
});
