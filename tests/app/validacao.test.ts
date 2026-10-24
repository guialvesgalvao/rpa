import { describe, expect, it } from 'vitest';

import { validarSelecao } from '../../src/app/validacao.js';

describe('validarSelecao', () => {
  it('aceita a seleção e remove pedidos sem documento', () => {
    expect(
      validarSelecao([
        { numero: '2604', docs: ['boleto', 'recibo'] },
        { numero: '2605', docs: [] },
      ]),
    ).toEqual([{ numero: '2604', docs: ['boleto', 'recibo'] }]);
  });

  it('documento repetido conta uma vez', () => {
    expect(validarSelecao([{ numero: '1', docs: ['boleto', 'boleto'] }])).toEqual([
      { numero: '1', docs: ['boleto'] },
    ]);
  });

  it('recusa número que não é só dígitos', () => {
    expect(() => validarSelecao([{ numero: '12a', docs: ['boleto'] }])).toThrow(
      'Seleção inválida: Número de pedido inválido',
    );
  });

  it('recusa documento fora do enum', () => {
    expect(() => validarSelecao([{ numero: '1', docs: ['danfe'] }])).toThrow(/^Seleção inválida/);
  });

  it('recusa formato inesperado', () => {
    expect(() => validarSelecao('2604')).toThrow(/^Seleção inválida/);
    expect(() => validarSelecao(undefined)).toThrow(/^Seleção inválida/);
  });

  it('recusa seleção sem nenhum documento', () => {
    expect(() => validarSelecao([])).toThrow('Selecione ao menos um pedido com um documento.');
    expect(() => validarSelecao([{ numero: '1', docs: [] }])).toThrow(
      'Selecione ao menos um pedido com um documento.',
    );
  });
});
