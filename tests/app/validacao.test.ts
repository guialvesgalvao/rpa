import { describe, expect, it } from 'vitest';

import { validarLogin, validarSelecao, validarSlug } from '../../src/app/validacao.js';

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

describe('validarLogin', () => {
  it('aceita e-mail e senha, aparando o e-mail', () => {
    expect(validarLogin({ email: ' ana@exemplo.com ', senha: 'segredo' })).toEqual({
      email: 'ana@exemplo.com',
      senha: 'segredo',
    });
  });

  it('não altera a senha', () => {
    expect(validarLogin({ email: 'a@b.c', senha: ' com espaço ' }).senha).toBe(' com espaço ');
  });

  it('recusa campos vazios, ausentes ou de outro tipo', () => {
    for (const input of [
      { email: '', senha: 'x' },
      { email: 'a@b.c', senha: '' },
      { email: '   ', senha: 'x' },
      { email: 'a@b.c' },
      { email: 1, senha: 'x' },
      undefined,
    ]) {
      expect(() => validarLogin(input)).toThrow('Informe o e-mail e a senha.');
    }
  });

  it('recusa e-mail ou senha com mais de 200 caracteres', () => {
    expect(() => validarLogin({ email: 'a'.repeat(201), senha: 'x' })).toThrow();
    expect(() => validarLogin({ email: 'a@b.c', senha: 'x'.repeat(201) })).toThrow();
    expect(validarLogin({ email: 'a@b.c', senha: 'x'.repeat(200) }).senha).toHaveLength(200);
  });
});

describe('validarSlug', () => {
  it('aceita o slug e apara os espaços', () => {
    expect(validarSlug(' roma ')).toBe('roma');
  });

  it('recusa o que não é um slug', () => {
    for (const input of ['', '   ', 'a'.repeat(101), 1, null, undefined, { slug: 'aba' }]) {
      expect(() => validarSlug(input)).toThrow('Empresa inválida.');
    }
  });
});
