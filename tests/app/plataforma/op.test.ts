import { describe, expect, it } from 'vitest';

import type { ClienteArtes } from '../../../src/app/plataforma/artes.js';
import type { ArteDoProduto, Cliente } from '../../../src/app/plataforma/contratos.js';
import {
  AVISO_SEM_CLIENTE,
  AVISO_SEM_CNPJ,
  montarPedidosTela,
} from '../../../src/app/plataforma/op.js';
import { ERRO_SEM_INSUMOS, type PedidoOp } from '../../../src/processes/bling/pedido-op.js';
import type { PedidoLido } from '../../../src/processes/op/pedidos.js';

// Dados sintéticos.
const CLIENTE: Cliente = {
  id: '3f0c6d2e-8a41-4b5e-9d3a-1c2b3d4e5f60',
  nomeExibicao: 'Pizzaria Ficticia',
  razaoSocial: 'Cliente Ficticio Ltda',
  nomeFantasia: 'Pizzaria Ficticia',
  cnpj: '11222333000181',
};
const PRODUTO = '11111111-1111-4111-8111-111111111111';
const ARTE: ArteDoProduto = {
  id: '33333333-3333-4333-8333-333333333333',
  nome: 'Padrão',
  cor: { id: '44444444-4444-4444-8444-444444444444', nome: 'Azul' },
  maquinas: [],
  criadoEm: '2026-10-30T12:00:00.000Z',
  temPdf: false,
  temImagem: true,
};

const pedido = (extra: Partial<PedidoOp> = {}): PedidoOp => ({
  numero: '9001',
  clienteNome: 'Cliente Ficticio Ltda',
  clienteFantasia: 'Pizzaria Ficticia',
  cnpj: CLIENTE.cnpj,
  dataVenda: new Date(2026, 9, 12),
  itens: [
    {
      descricao: 'Caixa',
      codigo: 'XX0001',
      unidade: 'UN',
      quantidade: 1000,
      insumos: [{ nome: 'Papel', unidade: 'UN', quantidadePorUnidade: 0.5 }],
    },
    {
      descricao: 'Sacola',
      codigo: 'XX0002',
      unidade: 'UN',
      quantidade: 10,
      erro: ERRO_SEM_INSUMOS,
    },
  ],
  ...extra,
});

type Chamadas = string[];

function apiFalsa(sobre: Partial<ClienteArtes> = {}) {
  const chamadas: Chamadas = [];
  const api: Pick<ClienteArtes, 'clientePorCnpj' | 'produtosDoCliente' | 'artesDoProduto'> = {
    clientePorCnpj: async (_e, cnpj) => {
      chamadas.push(`cliente:${cnpj}`);
      return CLIENTE;
    },
    produtosDoCliente: async () => {
      chamadas.push('produtos');
      return [
        { id: PRODUTO, nome: 'Caixa', codigo: 'XX0001', quantidadeArtes: 1 },
        { id: 'outro', nome: 'Sacola', codigo: 'XX0002', quantidadeArtes: 1 },
      ];
    },
    artesDoProduto: async (_e, _c, produtoId) => {
      chamadas.push(`artes:${produtoId}`);
      return [ARTE];
    },
    ...sobre,
  };
  return { api, chamadas };
}

describe('montarPedidosTela', () => {
  it('acha o cliente pelo CNPJ e as artes do item com insumos; o item com erro não busca artes', async () => {
    const { api, chamadas } = apiFalsa();
    const [tela] = await montarPedidosTela([{ numero: '9001', pedido: pedido() }], 'roma', api);

    expect(tela).toMatchObject({
      numero: '9001',
      situacao: 'ok',
      dataVenda: '12/10/2026',
      cliente: { id: CLIENTE.id },
      aviso: undefined,
    });
    if (tela?.situacao !== 'ok') throw new Error('esperado ok');
    expect(tela.dataPrevista).toBeUndefined();
    expect(tela.itens[0]).toMatchObject({ indice: 0, produtoId: PRODUTO, artes: [ARTE] });
    expect(tela.itens[1]).toMatchObject({ indice: 1, erro: ERRO_SEM_INSUMOS, artes: [] });
    // Uma lista de produtos por pedido; artes só do item que casou e gera OP.
    expect(chamadas).toEqual(['cliente:11222333000181', 'produtos', `artes:${PRODUTO}`]);
  });

  it('pedido sem CNPJ ou cliente não cadastrado: segue sem arte, com aviso', async () => {
    const { api, chamadas } = apiFalsa({ clientePorCnpj: async () => null });
    const telas = await montarPedidosTela(
      [
        { numero: '1', pedido: pedido({ numero: '1', cnpj: undefined }) },
        { numero: '2', pedido: pedido({ numero: '2' }) },
      ],
      'roma',
      api,
    );
    expect(telas.map((t) => (t.situacao === 'ok' ? t.aviso : t.erro))).toEqual([
      AVISO_SEM_CNPJ,
      AVISO_SEM_CLIENTE,
    ]);
    expect(chamadas).toEqual([]);
  });

  it('falha da API vira aviso e o pedido segue', async () => {
    const { api } = apiFalsa({
      produtosDoCliente: async () => {
        throw new Error('Sem conexão com o servidor.');
      },
    });
    const [tela] = await montarPedidosTela([{ numero: '9001', pedido: pedido() }], 'roma', api);
    expect(tela).toMatchObject({
      situacao: 'ok',
      aviso: 'Não foi possível buscar as artes: Sem conexão com o servidor.',
    });
  });

  it('pedido que não foi lido aparece com o erro e o passo a passo', async () => {
    const lido: PedidoLido = {
      numero: '7',
      erro: 'Pedido 7 não encontrado',
      passos: [{ texto: 'Busquei o pedido 7 na listagem', status: 'erro', erro: 'x' }],
    };
    const [tela] = await montarPedidosTela([lido], 'roma', apiFalsa().api);
    expect(tela).toEqual({ numero: '7', situacao: 'erro', erro: lido.erro, passos: lido.passos });
  });
});
