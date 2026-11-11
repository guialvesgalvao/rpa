import { describe, expect, it } from 'vitest';

import { consultaDaLista } from '../src/compras';

const PEDE = ['compras', 'compras.pedir'];
const ACOMPANHA = ['compras', 'compras.acompanhar'];

describe('consultaDaLista', () => {
  it('aceita da URL só escopo e status válidos para quem pede', () => {
    expect(consultaDaLista(PEDE, {})).toEqual({ escopo: 'meus' });
    expect(consultaDaLista(PEDE, { escopo: 'todos', status: 'x' })).toEqual({ escopo: 'meus' });
    expect(consultaDaLista(ACOMPANHA, { escopo: 'todos', status: 'concluida' })).toEqual({
      escopo: 'todos',
      status: 'concluida',
    });
    expect(consultaDaLista(PEDE, { escopo: ['abertos'] })).toEqual({ escopo: 'meus' });
  });
});
