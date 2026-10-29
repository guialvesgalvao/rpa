import { describe, expect, it } from 'vitest';

import {
  logoDaEmpresa,
  podeTrocarEmpresa,
  rotuloEmpresa,
  tituloJanela,
} from '../../src/app/empresa.js';

describe('empresa', () => {
  it('tem logo só das empresas que enviaram uma', () => {
    expect(logoDaEmpresa('aba')).toBe('assets/logo-aba.png');
    expect(logoDaEmpresa('roma')).toBeUndefined();
    expect(logoDaEmpresa('constructor')).toBeUndefined();
  });

  it('mostra o nome, ou o slug quando o nome está vazio', () => {
    expect(rotuloEmpresa(' ABA Embalagens ', 'aba')).toBe('ABA Embalagens');
    expect(rotuloEmpresa('  ', 'roma')).toBe('roma');
  });

  it('põe a empresa no título da janela', () => {
    expect(tituloJanela('Roma')).toBe('Roma — Automações');
    expect(tituloJanela(undefined)).toBe('Automações');
  });

  it('só troca de empresa com mais de uma e fora de uma execução', () => {
    expect(podeTrocarEmpresa(false, 2)).toBe(true);
    expect(podeTrocarEmpresa(true, 2)).toBe(false);
    expect(podeTrocarEmpresa(false, 1)).toBe(false);
    expect(podeTrocarEmpresa(false, 0)).toBe(false);
  });
});
