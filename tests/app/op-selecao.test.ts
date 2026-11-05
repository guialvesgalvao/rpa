import { describe, expect, it } from 'vitest';

import type { ItemOpTela, PedidoOpTela } from '../../src/app/api.js';
import {
  aplicarArtesRecarregadas,
  artePreSelecionada,
  chaveItem,
  descreverArte,
  type EscolhaItem,
  itensParaGerar,
  montarEscolhas,
  nomeDoCliente,
  resumirSelecao,
} from '../../src/app/op/lista.js';
import type { ArteDoProduto, Cliente } from '../../src/app/plataforma/contratos.js';

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

describe('aplicarArtesRecarregadas', () => {
  const cliente = (id: string): Cliente => ({
    id,
    nomeExibicao: 'Pizzaria Ficticia',
    razaoSocial: 'Cliente Ficticio Ltda',
    nomeFantasia: 'Pizzaria Ficticia',
    cnpj: '00000000000191',
  });
  const doCliente = (numero: string, clienteId: string, itens: ItemOpTela[]): PedidoOpTela => ({
    ...(pedido(numero, itens) as Extract<PedidoOpTela, { situacao: 'ok' }>),
    cliente: cliente(clienteId),
  });

  const X = arte('x', '2026-10-01T10:00:00.000Z', 'X');
  const Y = arte('y', '2026-10-02T10:00:00.000Z', 'Y');
  const NOVA = arte('nova', '2026-11-03T10:00:00.000Z', 'Nova');
  const COD = 'XX0000';

  const pedidos = [
    doCliente('9101', 'c1', [item(0, { artes: [Y, X] })]),
    doCliente('9102', 'c1', [item(0, { artes: [Y, X] })]),
    doCliente('9103', 'c1', [
      item(0, { artes: [Y, X] }),
      item(1, { artes: [X] }),
      item(2, { codigo: COD, erro: 'Produto sem insumos cadastrados', insumos: undefined }),
    ]),
    doCliente('9104', 'c2', [item(0, { artes: [X] })]),
  ];
  const escolhas = new Map<string, EscolhaItem>([
    [chaveItem('9101', 0), { marcado: true, arteId: 'x' }],
    [chaveItem('9102', 0), { marcado: false, arteId: 'y' }],
    [chaveItem('9103', 0), { marcado: true, arteId: undefined }],
    [chaveItem('9103', 1), { marcado: true, arteId: 'x' }],
    [chaveItem('9103', 2), { marcado: false }],
    [chaveItem('9104', 0), { marcado: true, arteId: 'x' }],
  ]);
  const recarga = {
    clienteId: 'c1',
    codigo: COD,
    produtoId: 'p1',
    artes: [NOVA, Y, X],
    origem: { numero: '9103', indice: 0 },
  };

  it('escolhe a arte nova só no item de origem; os outros mantêm X, Y', () => {
    const r = aplicarArtesRecarregadas(pedidos, escolhas, recarga);
    expect(r.escolhas.get(chaveItem('9103', 0))).toEqual({ marcado: true, arteId: 'nova' });
    expect(r.escolhas.get(chaveItem('9101', 0))).toEqual({ marcado: true, arteId: 'x' });
    expect(r.escolhas.get(chaveItem('9102', 0))).toEqual({ marcado: false, arteId: 'y' });
  });

  it('a arte nova aparece nas opções de todos os itens do cliente e código', () => {
    const r = aplicarArtesRecarregadas(pedidos, escolhas, recarga);
    for (const numero of ['9101', '9102', '9103']) {
      const p = r.pedidos.find((x) => x.numero === numero) as Extract<
        PedidoOpTela,
        { situacao: 'ok' }
      >;
      expect(p.itens[0]!.artes.map((a) => a.id)).toEqual(['nova', 'y', 'x']);
      expect(p.itens[0]!.produtoId).toBe('p1');
    }
  });

  it('"Sem arte" é mantido num item que não é a origem', () => {
    const r = aplicarArtesRecarregadas(pedidos, escolhas, {
      ...recarga,
      origem: { numero: '9101', indice: 0 },
    });
    expect(r.escolhas.get(chaveItem('9101', 0))).toEqual({ marcado: true, arteId: 'nova' });
    expect(r.escolhas.get(chaveItem('9103', 0))).toEqual({ marcado: true, arteId: undefined });
  });

  it('não mexe em outro código, outro cliente nem item com erro', () => {
    const r = aplicarArtesRecarregadas(pedidos, escolhas, recarga);
    const p9103 = r.pedidos[2] as Extract<PedidoOpTela, { situacao: 'ok' }>;
    expect(p9103.itens[1]!.artes).toEqual([X]);
    expect(p9103.itens[2]!.artes).toEqual([]);
    expect(r.pedidos[3]).toBe(pedidos[3]);
    expect(r.escolhas.get(chaveItem('9103', 1))).toEqual({ marcado: true, arteId: 'x' });
    expect(r.escolhas.get(chaveItem('9103', 2))).toEqual({ marcado: false });
    expect(r.escolhas.get(chaveItem('9104', 0))).toEqual({ marcado: true, arteId: 'x' });
  });

  it('não altera os pedidos nem as escolhas recebidos', () => {
    aplicarArtesRecarregadas(pedidos, escolhas, recarga);
    expect(escolhas.get(chaveItem('9103', 0))).toEqual({ marcado: true, arteId: undefined });
    expect((pedidos[0] as Extract<PedidoOpTela, { situacao: 'ok' }>).itens[0]!.artes).toEqual([
      Y,
      X,
    ]);
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

describe('pré-preenchimento da OP', () => {
  const preenchimento = { dataEntrega: '2026-11-20', observacao: 'Urgente' };

  it('é mantido ao buscar de novo, mesmo quando a arte escolhida some', () => {
    const pedidos = [pedido('9001', [item(0, { artes: [A] })])];
    const anteriores = new Map<string, EscolhaItem>([
      [chaveItem('9001', 0), { marcado: true, arteId: 'sumiu', preenchimento }],
    ]);
    const escolha = montarEscolhas(pedidos, anteriores).get(chaveItem('9001', 0));
    expect(escolha).toEqual({ marcado: true, arteId: 'a', preenchimento });
  });

  it('vai normalizado na geração, e sem dados não vai', () => {
    const pedidos = [pedido('9001', [item(0), item(1)])];
    const escolhas = new Map<string, EscolhaItem>([
      [chaveItem('9001', 0), { marcado: true, preenchimento: { observacao: '  Urgente ' } }],
      [chaveItem('9001', 1), { marcado: true, preenchimento: { observacao: '   ' } }],
    ]);
    expect(itensParaGerar(pedidos, escolhas)).toEqual([
      { numero: '9001', indice: 0, preenchimento: { observacao: 'Urgente' } },
      { numero: '9001', indice: 1 },
    ]);
    expect(resumirSelecao(pedidos, escolhas)).toBe(
      '2 OP(s) selecionada(s), 2 sem arte, 1 pré-preenchida(s)',
    );
  });
});
