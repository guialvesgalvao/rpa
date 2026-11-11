import { describe, expect, it } from 'vitest';

import {
  acoesDoPedido,
  descreverEventoCompra,
  ehCodigoDeInsumo,
  empresaTemCompras,
  EsquemaConsultaCompras,
  EsquemaDadosEventoCompra,
  EsquemaEdicaoPedidoCompra,
  EsquemaNovoPedidoCompra,
  escoposDaLista,
  filtrarInsumos,
  formatarQuantidade,
  lerQuantidade,
  pedidoEditavel,
  quantidadeParaCampo,
  ROTULOS_STATUS_COMPRA,
  rotuloInsumo,
  STATUS_COMPRA,
} from '../src/index.ts';

const ID = '7b0e6c0a-3f5e-4c59-9d0a-2f3c1a4b5d6e';

describe('pedidos de compra', () => {
  it('tem rótulo para cada status e só edita os não terminados', () => {
    expect(STATUS_COMPRA.map((s) => ROTULOS_STATUS_COMPRA[s])).toEqual([
      'Aberta',
      'Em andamento',
      'Concluída',
      'Cancelada',
    ]);
    expect(STATUS_COMPRA.filter((status) => pedidoEditavel({ status }))).toEqual([
      'aberta',
      'em_andamento',
    ]);
  });

  it('reconhece o insumo pelo prefixo TPP e o módulo só nas empresas com sincronização', () => {
    expect(ehCodigoDeInsumo('TPP001')).toBe(true);
    expect(ehCodigoDeInsumo('tpp001')).toBe(false);
    expect(ehCodigoDeInsumo('CX-35')).toBe(false);
    expect(ehCodigoDeInsumo(null)).toBe(false);
    expect(empresaTemCompras('roma')).toBe(true);
    expect(empresaTemCompras('aba')).toBe(false);
    expect(empresaTemCompras(undefined)).toBe(false);
  });

  it('consulta começa em "meus"', () => {
    expect(EsquemaConsultaCompras.parse({})).toEqual({ escopo: 'meus' });
    expect(EsquemaConsultaCompras.safeParse({ escopo: 'outros' }).success).toBe(false);
  });

  it('novo pedido: quantidade positiva com até 3 decimais e observação vazia vira null', () => {
    expect(EsquemaNovoPedidoCompra.parse({ insumoId: ID, quantidade: 2.5 })).toEqual({
      insumoId: ID,
      quantidade: 2.5,
    });
    expect(
      EsquemaNovoPedidoCompra.parse({ insumoId: ID, quantidade: 1.125, observacao: '  ' }),
    ).toMatchObject({ observacao: null });
    expect(
      EsquemaNovoPedidoCompra.parse({ insumoId: ID, quantidade: 3, observacao: ' urgente ' }),
    ).toMatchObject({ observacao: 'urgente' });
    for (const quantidade of [0, -1, 1.0001, 1_000_000_000]) {
      expect(EsquemaNovoPedidoCompra.safeParse({ insumoId: ID, quantidade }).success).toBe(false);
    }
    expect(
      EsquemaNovoPedidoCompra.safeParse({
        insumoId: ID,
        quantidade: 1,
        observacao: 'x'.repeat(501),
      }).success,
    ).toBe(false);
  });

  it('edição exige ao menos um campo e aceita limpar a observação', () => {
    expect(EsquemaEdicaoPedidoCompra.safeParse({}).success).toBe(false);
    expect(EsquemaEdicaoPedidoCompra.parse({ observacao: null })).toEqual({ observacao: null });
    expect(EsquemaEdicaoPedidoCompra.parse({ quantidade: 4 })).toEqual({ quantidade: 4 });
  });

  it('formata insumo e quantidade', () => {
    expect(rotuloInsumo({ codigo: 'TPP001', nome: 'Tinta Ficticia' })).toBe(
      'TPP001 — Tinta Ficticia',
    );
    expect(formatarQuantidade(1234.5)).toBe('1.234,5');
    expect(formatarQuantidade(3)).toBe('3');
  });

  it('descreve cada tipo de evento', () => {
    const ana = { id: ID, nome: 'Ana Ficticia' };
    const bia = { id: ID, nome: 'Bia Ficticia' };
    expect(descreverEventoCompra({ tipo: 'criacao' })).toBe('Pedido criado');
    expect(descreverEventoCompra({ tipo: 'status', de: 'aberta', para: 'em_andamento' })).toBe(
      'Aberta → Em andamento',
    );
    expect(descreverEventoCompra({ tipo: 'responsavel', de: null, para: ana })).toBe(
      'Responsável: Ana Ficticia',
    );
    expect(descreverEventoCompra({ tipo: 'responsavel', de: ana, para: bia })).toBe(
      'Responsável: Ana Ficticia → Bia Ficticia',
    );
    expect(
      descreverEventoCompra({
        tipo: 'edicao',
        quantidade: { de: 10, para: 12.5 },
        observacao: { de: null, para: 'urgente' },
      }),
    ).toBe('Quantidade: 10 → 12,5; Observação: (vazia) → urgente');
    expect(
      descreverEventoCompra({ tipo: 'edicao', insumo: { de: 'TPP001 — A', para: 'TPP002 — B' } }),
    ).toBe('Insumo: TPP001 — A → TPP002 — B');
  });

  it('valida os dados do evento pelo tipo', () => {
    expect(EsquemaDadosEventoCompra.safeParse({ tipo: 'status', de: 'aberta' }).success).toBe(
      false,
    );
    expect(EsquemaDadosEventoCompra.safeParse({ tipo: 'outro' }).success).toBe(false);
  });
});

describe('regras de tela', () => {
  const EU = '11111111-1111-4111-8111-111111111111';
  const OUTRO = '22222222-2222-4222-8222-222222222222';
  const PEDE = ['compras', 'compras.pedir'];
  const ACOMPANHA = ['compras', 'compras.acompanhar'];

  it('"Todos" só para quem acompanha', () => {
    expect(escoposDaLista(PEDE).map((e) => e.valor)).toEqual(['meus', 'abertos']);
    expect(escoposDaLista(ACOMPANHA).map((e) => e.valor)).toEqual(['meus', 'abertos', 'todos']);
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
});
