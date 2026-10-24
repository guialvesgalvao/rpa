import { describe, expect, it } from 'vitest';

import { parseNumeros } from '../../../src/processes/bling/numeros.js';

describe('parseNumeros', () => {
  it('aceita um por linha e outros separadores', () => {
    expect(parseNumeros('1\n2\r\n3, 4; 5 6').validos).toEqual(['1', '2', '3', '4', '5', '6']);
  });

  it('remove duplicados mantendo a ordem', () => {
    expect(parseNumeros('3\n1\n3\n2\n1').validos).toEqual(['3', '1', '2']);
  });

  it('separa entradas que não são números', () => {
    expect(parseNumeros('10\nabc\n12a\n\n 11 ')).toEqual({
      validos: ['10', '11'],
      invalidos: ['abc', '12a'],
    });
  });

  it('lista vazia', () => {
    expect(parseNumeros('  \n ')).toEqual({ validos: [], invalidos: [] });
  });
});
