import { describe, expect, it } from 'vitest';

import { nomesDoBoleto } from '../../../src/processes/bling/boleto.js';

const data = (dia: number, mes: number, ano: number): Date => new Date(ano, mes - 1, dia);

const dados = {
  numero: '1001',
  cliente: 'Exemplo',
  parcelas: [data(25, 10, 2026), data(1, 11, 2026), data(8, 11, 2026), data(15, 11, 2026)],
  possuiNf: false,
};

describe('nomesDoBoleto', () => {
  it('um nome por página, na ordem das parcelas', () => {
    expect(nomesDoBoleto(4, dados)).toEqual([
      'Boleto Exemplo 25 10 26.pdf',
      'Boleto Exemplo 01 11 26.pdf',
      'Boleto Exemplo 08 11 26.pdf',
      'Boleto Exemplo 15 11 26.pdf',
    ]);
  });

  it('erro se o número de páginas difere do de parcelas', () => {
    expect(() => nomesDoBoleto(1, dados)).toThrow('Boleto com 1 páginas, pedido com 4 parcelas');
  });
});
