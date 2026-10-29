import { describe, expect, it } from 'vitest';

import { logoDaEmpresa, ordenarEmpresas, slugValido } from '../src/empresas';

describe('ordenarEmpresas', () => {
  it('ordena pelo nome sem diferenciar acento e caixa, sem mudar a lista recebida', () => {
    const empresas = [
      { slug: 'roma', nome: 'Roma' },
      { slug: 'eco', nome: 'Écran' },
      { slug: 'aba', nome: 'aba' },
      { slug: 'delta', nome: 'Delta' },
    ];

    expect(ordenarEmpresas(empresas).map((empresa) => empresa.slug)).toEqual([
      'aba',
      'delta',
      'eco',
      'roma',
    ]);
    expect(empresas[0]?.slug).toBe('roma');
  });

  it('desempata nomes iguais pelo slug', () => {
    const empresas = [
      { slug: 'b', nome: 'Mesma' },
      { slug: 'a', nome: 'Mesma' },
    ];

    expect(ordenarEmpresas(empresas).map((empresa) => empresa.slug)).toEqual(['a', 'b']);
  });
});

describe('logoDaEmpresa', () => {
  it('devolve o logo de public/empresas quando existe', () => {
    expect(logoDaEmpresa('aba')).toBe('/empresas/aba.png');
  });

  it('não tem logo para empresa sem identidade nem para chaves herdadas', () => {
    expect(logoDaEmpresa('roma')).toBeUndefined();
    expect(logoDaEmpresa('toString')).toBeUndefined();
  });
});

describe('slugValido', () => {
  it.each(['aba', 'roma', 'empresa-2'])('aceita %s', (slug) => {
    expect(slugValido(slug)).toBe(true);
  });

  it.each(['', 'ABA', 'a/b', '../x', 'a b', 'a'.repeat(65), undefined, 1])('recusa %j', (slug) => {
    expect(slugValido(slug)).toBe(false);
  });
});
