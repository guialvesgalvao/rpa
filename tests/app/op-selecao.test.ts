import { describe, expect, it } from 'vitest';

import type { ItemOpTela, PedidoOpTela } from '../../src/app/api.js';
import {
  artePreSelecionada,
  chaveItem,
  descreverArte,
  itensParaGerar,
  montarEscolhas,
  nomeDoCliente,
  resumirSelecao,
} from '../../src/app/op/lista.js';
import type { ArteDoProduto } from '../../src/app/plataforma/contratos.js';

// Dados sintéticos.
const arte = (id: string, criadoEm: string, nome = 'Padrão'): ArteDoProduto => ({
  id,
  nome,
  cor: { id: `${id}-cor`, nome: 'Azul' },
  maquinas: [{ id: `${id}-maq`, nome: 'Favorit' }],
  criadoEm,
  temPdf: true,
  temImagem: true,
});

const A = arte('a', '2026-10-01T10:00:00.000Z', 'Antiga');
const B = arte('b', '2026-10-30T10:00:00.000Z', 'Nova');
const C = arte('c', '2026-10-30T10:00:00.000Z', 'Empate');

const item = (indice: number, extra: Partial<ItemOpTela> = {}): ItemOpTela => ({
  indice,
  descricao: `Produto ${indice}`,
  codigo: `XX000${indice}`,
  unidade: 'UN',
  quantidade: 10,
  insumos: [{ nome: 'Papel', unidade: 'UN', quantidadePorUnidade: 1 }],
  produtoId: null,
  artes: [],
  ...extra,
});

const pedido = (numero: string, itens: ItemOpTela[]): PedidoOpTela => ({
  numero,
  situacao: 'ok',
  clienteNome: 'Cliente Ficticio Ltda',
  clienteFantasia: 'Pizzaria Ficticia',
  dataVenda: '12/10/2026',
  cliente: null,
  itens,
});

describe('artePreSelecionada', () => {
  it('sem arte: nenhuma', () => {
    expect(artePreSelecionada([])).toBeUndefined();
  });

  it('uma arte: ela', () => {
    expect(artePreSelecionada([A])?.id).toBe('a');
  });

  it('várias: a mais nova, em qualquer ordem', () => {
    expect(artePreSelecionada([A, B])?.id).toBe('b');
    expect(artePreSelecionada([B, A])?.id).toBe('b');
  });

  it('empate de data: a primeira da lista (ordem da API)', () => {
    expect(artePreSelecionada([C, B, A])?.id).toBe('c');
    expect(artePreSelecionada([B, C])?.id).toBe('b');
  });
});

describe('montarEscolhas', () => {
  const pedidos = [
    pedido('9001', [
      item(0, { artes: [A, B] }),
      item(1, { erro: 'Produto sem insumos cadastrados', insumos: undefined }),
      item(2),
    ]),
    { numero: '9002', situacao: 'erro', erro: 'Pedido não encontrado', passos: [] } as PedidoOpTela,
  ];

  it('marca os produtos que geram OP, com a arte mais nova; o com erro fica desmarcado', () => {
    const escolhas = montarEscolhas(pedidos);
    expect(escolhas.get(chaveItem('9001', 0))).toEqual({ marcado: true, arteId: 'b' });
    expect(escolhas.get(chaveItem('9001', 1))).toEqual({ marcado: false });
    expect(escolhas.get(chaveItem('9001', 2))).toEqual({ marcado: true, arteId: undefined });
    expect([...escolhas.keys()].some((k) => k.startsWith('9002'))).toBe(false);
  });

  it('mantém a escolha anterior se a arte ainda existe; senão volta à pré-seleção', () => {
    const anteriores = new Map([
      [chaveItem('9001', 0), { marcado: false, arteId: 'a' }],
      [chaveItem('9001', 2), { marcado: false, arteId: 'sumiu' }],
    ]);
    const escolhas = montarEscolhas(pedidos, anteriores);
    expect(escolhas.get(chaveItem('9001', 0))).toEqual({ marcado: false, arteId: 'a' });
    expect(escolhas.get(chaveItem('9001', 2))).toEqual({ marcado: false, arteId: undefined });
  });

  it('não reutiliza o objeto da escolha anterior', () => {
    const anterior = { marcado: true, arteId: 'a' };
    const escolhas = montarEscolhas(pedidos, new Map([[chaveItem('9001', 0), anterior]]));
    escolhas.get(chaveItem('9001', 0))!.marcado = false;
    expect(anterior.marcado).toBe(true);
  });
});

describe('itensParaGerar e resumo', () => {
  const pedidos = [
    pedido('9001', [
      item(0, { artes: [A, B] }),
      item(1, { erro: 'Produto sem insumos cadastrados' }),
      item(2),
    ]),
    pedido('9003', [item(0, { artes: [A] })]),
  ];

  it('só os marcados que geram OP, na ordem Pedido → Produto, com a arte escolhida', () => {
    const escolhas = montarEscolhas(pedidos);
    escolhas.set(chaveItem('9003', 0), { marcado: false, arteId: 'a' });
    // Mesmo marcado à força, item com erro não entra.
    escolhas.set(chaveItem('9001', 1), { marcado: true });

    expect(itensParaGerar(pedidos, escolhas)).toEqual([
      { numero: '9001', indice: 0, arteId: 'b' },
      { numero: '9001', indice: 2 },
    ]);
    expect(resumirSelecao(pedidos, escolhas)).toBe('2 OP(s) selecionada(s), 1 sem arte');
  });

  it('"Sem arte" escolhido gera sem arteId', () => {
    const escolhas = montarEscolhas(pedidos);
    escolhas.set(chaveItem('9001', 0), { marcado: true, arteId: undefined });
    expect(itensParaGerar(pedidos, escolhas)[0]).toEqual({ numero: '9001', indice: 0 });
  });
});

describe('textos', () => {
  it('descreve cor e máquinas da arte', () => {
    expect(descreverArte({ ...B, maquinas: [...B.maquinas, { id: 'r', nome: 'Rekord' }] })).toBe(
      'Cor: Azul · Máquinas: Favorit, Rekord',
    );
  });

  it('cliente: fantasia, senão o nome', () => {
    const p = pedido('1', []) as Extract<PedidoOpTela, { situacao: 'ok' }>;
    expect(nomeDoCliente(p)).toBe('Pizzaria Ficticia');
    expect(nomeDoCliente({ ...p, clienteFantasia: ' ' })).toBe('Cliente Ficticio Ltda');
  });
});
