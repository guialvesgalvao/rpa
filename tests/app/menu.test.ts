import { describe, expect, it } from 'vitest';

import {
  abaAoRemontar,
  abaInicial,
  abasDoPerfil,
  AUTOMACOES,
  ordenarMenu,
  podeSincronizarBling,
  podeUsarOp,
} from '../../src/app/menu.js';

const rotulos = (itens: { rotulo: string }[]) => itens.map((item) => item.rotulo);

describe('menu de automações', () => {
  it('ordena Artes, Fatura e OP', () => {
    expect(rotulos(ordenarMenu(AUTOMACOES))).toEqual(['Artes', 'Fatura', 'OP']);
  });

  it('ignora maiúsculas e acentos na ordem', () => {
    const itens = [{ rotulo: 'Ótica' }, { rotulo: 'artes' }, { rotulo: 'Banco' }];
    expect(rotulos(ordenarMenu(itens))).toEqual(['artes', 'Banco', 'Ótica']);
  });

  it('não altera o array original', () => {
    const itens = [{ rotulo: 'OP' }, { rotulo: 'Artes' }];
    ordenarMenu(itens);
    expect(rotulos(itens)).toEqual(['OP', 'Artes']);
  });

  it('abre na primeira aba em ordem alfabética', () => {
    expect(abaInicial(AUTOMACOES).id).toBe('artes');
  });

  it('não repete ids', () => {
    const ids = AUTOMACOES.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('admin da Roma vê todas as abas', () => {
    expect(abasDoPerfil('admin', 'roma').map((aba) => aba.id)).toEqual(
      AUTOMACOES.map((aba) => aba.id),
    );
  });

  it('admin de outra empresa, ou sem empresa, não vê a OP', () => {
    for (const empresa of ['aba', undefined, 'ROMA', ' roma']) {
      expect(abasDoPerfil('admin', empresa).map((aba) => aba.id)).toEqual(['fatura', 'artes']);
    }
  });

  it.each(['aba', 'roma', undefined])('arte finalista (%s) vê só Artes e abre nela', (empresa) => {
    const abas = abasDoPerfil('arte_finalista', empresa);
    expect(abas.map((aba) => aba.id)).toEqual(['artes']);
    expect(abaInicial(abas).id).toBe('artes');
  });

  it('OP só para admin + roma', () => {
    expect(podeUsarOp('admin', 'roma')).toBe(true);
    expect(podeUsarOp('admin', 'aba')).toBe(false);
    expect(podeUsarOp('admin', undefined)).toBe(false);
    expect(podeUsarOp('arte_finalista', 'roma')).toBe(false);
    expect(podeUsarOp('arte_finalista', 'aba')).toBe(false);
  });

  it('não altera AUTOMACOES ao montar as abas do perfil', () => {
    abasDoPerfil('admin', 'roma').pop();
    expect(AUTOMACOES).toHaveLength(3);
  });

  it('ao remontar, fica na aba atual se ela continua liberada', () => {
    const daRoma = abasDoPerfil('admin', 'roma');
    const daAba = abasDoPerfil('admin', 'aba');
    expect(abaAoRemontar(daAba, 'fatura').id).toBe('fatura');
    expect(abaAoRemontar(daRoma, 'op').id).toBe('op');
  });

  it('ao remontar sem a aba atual (OP fora da Roma) ou sem aba, abre na primeira', () => {
    expect(abaAoRemontar(abasDoPerfil('admin', 'aba'), 'op').id).toBe('artes');
    expect(abaAoRemontar(abasDoPerfil('admin', 'roma'), undefined).id).toBe('artes');
  });
});

describe('podeSincronizarBling', () => {
  it('só o admin da Roma vê a sincronização com o Bling', () => {
    expect(podeSincronizarBling('admin', 'roma')).toBe(true);
    expect(podeSincronizarBling('arte_finalista', 'roma')).toBe(false);
    expect(podeSincronizarBling('admin', 'aba')).toBe(false);
    expect(podeSincronizarBling('admin', 'ROMA')).toBe(false);
    expect(podeSincronizarBling('admin', undefined)).toBe(false);
  });
});
