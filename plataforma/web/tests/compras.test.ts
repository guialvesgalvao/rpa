import { describe, expect, it } from 'vitest';

import {
  acoesDoPedido,
  consultaDaLista,
  escoposDaLista,
  filtrarInsumos,
  lerQuantidade,
  quantidadeParaCampo,
} from '../src/compras';

const EU = '11111111-1111-4111-8111-111111111111';
const OUTRO = '22222222-2222-4222-8222-222222222222';
const PEDE = ['compras', 'compras.pedir'];
const ACOMPANHA = ['compras', 'compras.acompanhar'];

describe('escoposDaLista e consultaDaLista', () => {
  it('"Todos" só para quem acompanha', () => {
    expect(escoposDaLista(PEDE).map((e) => e.valor)).toEqual(['meus', 'abertos']);
    expect(escoposDaLista(ACOMPANHA).map((e) => e.valor)).toEqual(['meus', 'abertos', 'todos']);
  });

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

describe('acoesDoPedido', () => {
  const pedido = (
    status: 'aberta' | 'em_andamento' | 'concluida' | 'cancelada',
    criador = EU,
    responsavel: string | null = null,
  ) => ({
    status,
    criador: { id: criador, nome: 'Criador' },
    responsavel: responsavel ? { id: responsavel, nome: 'Responsável' } : null,
  });

  it('o criador que pede edita e cancela enquanto está aberto', () => {
    expect(acoesDoPedido(pedido('aberta'), EU, PEDE)).toEqual({
      assumir: false,
      mudarStatus: false,
      editar: true,
      cancelar: true,
    });
    expect(acoesDoPedido(pedido('em_andamento'), EU, PEDE)).toMatchObject({
      editar: true,
      cancelar: false,
    });
    expect(acoesDoPedido(pedido('concluida'), EU, PEDE)).toMatchObject({
      editar: false,
      cancelar: false,
    });
  });

  it('o criador sem compras.pedir só vê', () => {
    expect(acoesDoPedido(pedido('aberta'), EU, ['compras'])).toMatchObject({
      editar: false,
      cancelar: true,
    });
  });

  it('quem acompanha assume, muda o status e edita; não assume o que já é dele em andamento', () => {
    expect(acoesDoPedido(pedido('aberta', OUTRO), EU, ACOMPANHA)).toEqual({
      assumir: true,
      mudarStatus: true,
      editar: true,
      cancelar: false,
    });
    expect(acoesDoPedido(pedido('em_andamento', OUTRO, EU), EU, ACOMPANHA).assumir).toBe(false);
    expect(acoesDoPedido(pedido('em_andamento', OUTRO, OUTRO), EU, ACOMPANHA).assumir).toBe(true);
    expect(acoesDoPedido(pedido('cancelada', OUTRO), EU, ACOMPANHA)).toEqual({
      assumir: false,
      mudarStatus: true,
      editar: false,
      cancelar: false,
    });
  });
});

describe('filtrarInsumos', () => {
  const insumos = [
    { id: '1', codigo: 'TPP001', nome: 'Tinta Preta' },
    { id: '2', codigo: 'TPP002', nome: 'Cola Branca Ácida' },
  ];

  it('busca no código e no nome, sem maiúsculas nem acentos', () => {
    expect(filtrarInsumos(insumos, '').map((i) => i.id)).toEqual(['1', '2']);
    expect(filtrarInsumos(insumos, 'tpp002').map((i) => i.id)).toEqual(['2']);
    expect(filtrarInsumos(insumos, 'acida').map((i) => i.id)).toEqual(['2']);
    expect(filtrarInsumos(insumos, 'verniz')).toEqual([]);
  });
});

describe('lerQuantidade', () => {
  it('lê o formato brasileiro e o ponto decimal', () => {
    expect(lerQuantidade('10')).toBe(10);
    expect(lerQuantidade('2,5')).toBe(2.5);
    expect(lerQuantidade(' 1.234,125 ')).toBe(1234.125);
    expect(lerQuantidade('1.5')).toBe(1.5);
  });

  it('recusa vazio, zero, negativo, texto e mais de 3 casas', () => {
    for (const texto of ['', '0', '-1', 'abc', '1,2345', '1,2,3', '1.2.3', '1e3']) {
      expect(lerQuantidade(texto)).toBeUndefined();
    }
  });

  it('volta para o campo com vírgula', () => {
    expect(quantidadeParaCampo(12.5)).toBe('12,5');
    expect(quantidadeParaCampo(3)).toBe('3');
  });
});
