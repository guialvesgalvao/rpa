import { describe, expect, it } from 'vitest';

import { TEMA_NEUTRO, TEMAS, temaDaEmpresa } from '../src/empresas.ts';

describe('temaDaEmpresa', () => {
  it('devolve o tema da empresa cadastrada', () => {
    expect(temaDaEmpresa('aba')).toEqual(TEMAS.aba);
    expect(temaDaEmpresa('aba').primaria).toBe('#b62b38');
  });

  it('devolve o tema neutro para slug desconhecido', () => {
    expect(temaDaEmpresa('desconhecida')).toBe(TEMA_NEUTRO);
    expect(temaDaEmpresa('')).toBe(TEMA_NEUTRO);
  });

  it('não confunde propriedades herdadas com empresas', () => {
    expect(temaDaEmpresa('toString')).toBe(TEMA_NEUTRO);
    expect(temaDaEmpresa('__proto__')).toBe(TEMA_NEUTRO);
  });
});
