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

describe('tema da Roma', () => {
  it('usa a paleta da Roma', () => {
    expect(temaDaEmpresa('roma')).toEqual({
      primaria: '#9c2a24',
      primariaEscura: '#7a201c',
      destaque: '#010101',
      destaqueEscura: '#333333',
    });
  });
});

// Contraste WCAG 2.x entre duas cores `#rrggbb`.
function luminancia(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contraste(a: string, b: string): number {
  const [claro, escuro] = [luminancia(a), luminancia(b)].sort((x, y) => y - x) as [number, number];
  return (claro + 0.05) / (escuro + 0.05);
}

describe('contraste dos temas', () => {
  const temas = [...Object.entries(TEMAS), ['neutro', TEMA_NEUTRO] as const];

  it('confere a fórmula com valores conhecidos', () => {
    expect(contraste('#ffffff', '#000000')).toBeCloseTo(21, 5);
    expect(contraste('#9c2a24', '#ffffff')).toBeCloseTo(7.58, 1);
  });

  it.each(temas)('%s: primária e primária escura legíveis como texto sobre branco', (_, tema) => {
    expect(contraste(tema.primaria, '#ffffff')).toBeGreaterThanOrEqual(4.5);
    expect(contraste(tema.primariaEscura, '#ffffff')).toBeGreaterThanOrEqual(4.5);
  });

  it.each(temas)('%s: destaque e destaque escuro aguentam texto branco (botão)', (_, tema) => {
    expect(contraste(tema.destaque, '#ffffff')).toBeGreaterThanOrEqual(3);
    expect(contraste(tema.destaqueEscura, '#ffffff')).toBeGreaterThanOrEqual(3);
  });
});
