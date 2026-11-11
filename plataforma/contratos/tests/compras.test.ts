import { describe, expect, it } from 'vitest';

import {
  descreverEventoCompra,
  ehCodigoDeInsumo,
  empresaTemCompras,
  EsquemaConsultaCompras,
  EsquemaDadosEventoCompra,
  EsquemaEdicaoPedidoCompra,
  EsquemaNovoPedidoCompra,
  formatarQuantidade,
  pedidoEditavel,
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
