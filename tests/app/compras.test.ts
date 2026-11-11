import { describe, expect, it } from 'vitest';

import { dadosDoFormulario } from '../../src/app/compras/formulario.js';
import { resumoDoPedido } from '../../src/app/compras/pedidos.js';
import type { PedidoCompra } from '../../src/app/plataforma/contratos.js';

// Dados sintéticos.
const INSUMO = { id: '22222222-2222-4222-8222-222222222222', codigo: 'TPP001', nome: 'Tinta' };
const OUTRO = '44444444-4444-4444-8444-444444444444';

const pedido: PedidoCompra = {
  id: '11111111-1111-4111-8111-111111111111',
  insumo: INSUMO,
  quantidade: 10,
  observacao: null,
  status: 'aberta',
  criador: { id: '33333333-3333-4333-8333-333333333333', nome: 'Pedro Ficticio' },
  areaCriador: 'producao',
  responsavel: null,
  criadoEm: '2026-11-11T12:00:00.000Z',
  atualizadoEm: '2026-11-11T12:00:00.000Z',
};

describe('dadosDoFormulario', () => {
  it('novo pedido: insumo, quantidade no formato brasileiro e observação vazia vira null', () => {
    expect(dadosDoFormulario({ insumoId: INSUMO.id, quantidade: '2,5', observacao: '  ' })).toEqual(
      { dados: { insumoId: INSUMO.id, quantidade: 2.5, observacao: null } },
    );
  });

  it('recusa insumo vazio e quantidade inválida', () => {
    expect(dadosDoFormulario({ insumoId: '', quantidade: '1', observacao: '' })).toEqual({
      erro: 'Escolha o insumo.',
    });
    for (const quantidade of ['', '0', 'abc', '1,2345']) {
      expect(dadosDoFormulario({ insumoId: INSUMO.id, quantidade, observacao: '' })).toHaveProperty(
        'erro',
      );
    }
  });

  it('edição: envia só o que mudou; sem mudança, avisa', () => {
    expect(
      dadosDoFormulario({ insumoId: INSUMO.id, quantidade: '12,5', observacao: 'urgente' }, pedido),
    ).toEqual({ dados: { quantidade: 12.5, observacao: 'urgente' } });
    expect(
      dadosDoFormulario({ insumoId: OUTRO, quantidade: '10', observacao: '' }, pedido),
    ).toEqual({ dados: { insumoId: OUTRO } });
    expect(
      dadosDoFormulario({ insumoId: INSUMO.id, quantidade: '10', observacao: '' }, pedido),
    ).toEqual({ erro: 'Nada foi alterado.' });
  });
});

describe('resumoDoPedido', () => {
  it('quantidade, criador com área e responsável', () => {
    const resumo = resumoDoPedido({ ...pedido, quantidade: 1234.5 });
    expect(resumo).toContain('Quantidade 1.234,5');
    expect(resumo).toContain('Pedro Ficticio (Produção)');
    expect(resumo).toContain('Responsável: ninguém');
    expect(resumoDoPedido({ ...pedido, areaCriador: null, criador: null })).toContain(
      'Usuário removido (Sem área)',
    );
  });
});
