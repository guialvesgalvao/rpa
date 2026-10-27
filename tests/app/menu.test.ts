import { describe, expect, it } from 'vitest';

import { abaInicial, AUTOMACOES, ordenarMenu } from '../../src/app/menu.js';

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
});
