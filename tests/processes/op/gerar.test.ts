import { describe, expect, it } from 'vitest';

import { ERRO_SEM_INSUMOS, type PedidoOp } from '../../../src/processes/bling/pedido-op.js';
import {
  type ArteEscolhida,
  type DepsGerarOps,
  gerarOps,
  type ItemGeracao,
  montarOrdem,
  type ResultadoOp,
} from '../../../src/processes/op/gerar.js';
import type { OrdemProducao } from '../../../src/processes/op/tipos.js';

// Dados sintéticos.
const PNG = { bytes: Uint8Array.from([0x89, 0x50, 0x4e, 0x47]), mime: 'image/png' };
const ARTE: ArteEscolhida = {
  id: 'arte-1',
  cor: 'Azul',
  maquinas: ['Favorit', 'Rekord'],
  temImagem: true,
};

const pedido: PedidoOp = {
  numero: '9001',
  clienteNome: 'Cliente Ficticio Ltda',
  clienteFantasia: 'Pizzaria Ficticia',
  cnpj: '11222333000181',
  dataVenda: new Date(2026, 9, 12),
  dataPrevista: new Date(2026, 9, 20),
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
    {
      descricao: 'Copo',
      codigo: 'XX0003',
      unidade: 'UN',
      quantidade: 50,
      insumos: [{ nome: 'Papel', unidade: 'UN', quantidadePorUnidade: 1 }],
    },
  ],
};

const HOJE = new Date(2026, 10, 3);

function deps(itens: ItemGeracao[], sobre: Partial<DepsGerarOps> = {}) {
  const ordens: OrdemProducao[] = [];
  const progresso: ResultadoOp[] = [];
  const falhas: string[] = [];
  const reservas: number[] = [];
  let proximo = 41;
  const base: DepsGerarOps = {
    itens,
    empresa: 'Roma Embalagens',
    agora: () => HOJE,
    reservarNumeros: async (quantidade) => {
      reservas.push(quantidade);
      return Array.from({ length: quantidade }, () => proximo++);
    },
    baixarImagem: async () => PNG,
    salvarPdf: async (ordem) => {
      ordens.push(ordem);
      return `C:\\OPs\\OP ${ordem.numero}.pdf`;
    },
    onProgresso: (r) => progresso.push(r),
    onFalha: (r) => falhas.push(`${r.numero}:${r.codigo}:${r.erro}`),
    ...sobre,
  };
  return { deps: base, ordens, progresso, falhas, reservas };
}

describe('gerarOps', () => {
  it('gera uma OP por produto com números sequenciais; sem insumos vira erro sem reservar número', async () => {
    const t = deps([
      { pedido, indice: 0, arte: ARTE },
      { pedido, indice: 1 },
      { pedido, indice: 2 },
    ]);

    const resultados = await gerarOps(t.deps);

    expect(resultados.map((r) => [r.codigo, r.status, r.numeroOp])).toEqual([
      ['XX0001', 'ok', 41],
      ['XX0002', 'erro', undefined],
      ['XX0003', 'ok', 42],
    ]);
    expect(t.reservas).toEqual([2]);
    expect(resultados[1]).toMatchObject({ erro: ERRO_SEM_INSUMOS });
    expect(t.falhas).toEqual([`9001:XX0002:${ERRO_SEM_INSUMOS}`]);
    expect(resultados[0]).toMatchObject({
      arquivos: ['C:\\OPs\\OP 41.pdf'],
      detalhe: 'OP nº 41',
    });
    expect(resultados[2]?.detalhe).toBe('OP nº 42 (sem arte)');
    // O último progresso de cada item é o resultado final.
    expect(t.progresso.at(-1)).toEqual(resultados[2]);
  });

  it('monta o modelo do PDF com cliente, datas, item, insumos e arte', async () => {
    const t = deps([{ pedido, indice: 0, arte: ARTE }]);
    await gerarOps(t.deps);

    expect(t.ordens[0]).toEqual({
      numero: 41,
      data: HOJE,
      empresa: 'Roma Embalagens',
      cliente: { nome: 'Cliente Ficticio Ltda', fantasia: 'Pizzaria Ficticia' },
      numeroPedido: '9001',
      previsaoInicial: pedido.dataVenda,
      previsaoFinal: pedido.dataPrevista,
      item: { descricao: 'Caixa', codigo: 'XX0001', unidade: 'UN', quantidade: 1000 },
      insumos: [{ nome: 'Papel', unidade: 'UN', quantidadePorUnidade: 0.5 }],
      arte: { cor: 'Azul', maquinas: ['Favorit', 'Rekord'], imagem: PNG },
    });
  });

  it('com logo, toda OP leva a logo da empresa no cabeçalho', async () => {
    const LOGO = { bytes: new Uint8Array([9, 9]), mime: 'image/png' };
    const t = deps(
      [
        { pedido, indice: 0, arte: ARTE },
        { pedido, indice: 2 },
      ],
      { logo: LOGO },
    );
    await gerarOps(t.deps);

    expect(t.ordens).toHaveLength(2);
    for (const ordem of t.ordens) expect(ordem.logo).toBe(LOGO);
  });

  it('sem logo, nenhuma OP leva logo (o cabeçalho mostra o nome)', async () => {
    const t = deps([
      { pedido, indice: 0 },
      { pedido, indice: 2 },
    ]);
    await gerarOps(t.deps);

    expect(t.ordens).toHaveLength(2);
    for (const ordem of t.ordens) expect(ordem).not.toHaveProperty('logo');
  });

  it('arte sem imagem não baixa nada; sem arte, o PDF sai sem o bloco', async () => {
    let baixadas = 0;
    const t = deps(
      [
        { pedido, indice: 0, arte: { ...ARTE, temImagem: false } },
        { pedido, indice: 2 },
      ],
      {
        baixarImagem: async () => {
          baixadas++;
          return PNG;
        },
      },
    );
    await gerarOps(t.deps);
    expect(baixadas).toBe(0);
    expect(t.ordens[0]?.arte).toEqual({ cor: 'Azul', maquinas: ['Favorit', 'Rekord'] });
    expect(t.ordens[1]?.arte).toBeUndefined();
  });

  it('cada OP sai com o próprio pré-preenchimento; a sem dados sai em branco', async () => {
    const t = deps([
      { pedido, indice: 0, preenchimento: { dataEntrega: '2026-11-20', observacao: 'Urgente' } },
      { pedido, indice: 2 },
    ]);
    await gerarOps(t.deps);
    expect(t.ordens[0]?.dataEntrega).toEqual(new Date(2026, 10, 20));
    expect(t.ordens[0]?.observacao).toBe('Urgente');
    expect(t.ordens[1]?.dataEntrega).toBeUndefined();
    expect(t.ordens[1]?.observacao).toBeUndefined();
  });

  it('falha ao baixar a imagem: só aquele item falha, antes de reservar números', async () => {
    const t = deps(
      [
        { pedido, indice: 0, arte: ARTE },
        { pedido, indice: 2 },
      ],
      {
        baixarImagem: async () => {
          throw new Error('Sem conexão com o servidor.');
        },
      },
    );
    const resultados = await gerarOps(t.deps);
    expect(resultados.map((r) => r.status)).toEqual(['erro', 'ok']);
    expect(resultados[0]?.passos).toEqual([
      { texto: 'Baixei a imagem da arte', status: 'erro', erro: 'Sem conexão com o servidor.' },
    ]);
    expect(t.reservas).toEqual([1]);
  });

  it('falha na reserva: todos os itens prontos falham e nenhum PDF sai', async () => {
    const t = deps(
      [
        { pedido, indice: 0 },
        { pedido, indice: 2 },
      ],
      {
        reservarNumeros: async () => {
          throw new Error('Sem permissão.');
        },
      },
    );
    const resultados = await gerarOps(t.deps);
    expect(resultados.map((r) => r.status)).toEqual(['erro', 'erro']);
    expect(resultados[0]?.erro).toBe(
      'Não foi possível reservar os números das OPs: Sem permissão.',
    );
    expect(t.ordens).toEqual([]);
  });

  it('reserva com quantidade errada também falha', async () => {
    const t = deps(
      [
        { pedido, indice: 0 },
        { pedido, indice: 2 },
      ],
      {
        reservarNumeros: async () => [1],
      },
    );
    const resultados = await gerarOps(t.deps);
    expect(resultados.every((r) => r.status === 'erro')).toBe(true);
  });

  it('falha num PDF não interrompe os outros', async () => {
    const t = deps([
      { pedido, indice: 0 },
      { pedido, indice: 2 },
    ]);
    const salvar = t.deps.salvarPdf;
    t.deps.salvarPdf = async (ordem) => {
      if (ordem.item.codigo === 'XX0001') throw new Error('Disco cheio');
      return salvar(ordem);
    };
    const resultados = await gerarOps(t.deps);
    expect(resultados.map((r) => [r.status, r.numeroOp])).toEqual([
      ['erro', 41],
      ['ok', 42],
    ]);
    expect(resultados[0]?.passos).toEqual([
      { texto: 'Gerei o PDF da OP nº 41', status: 'erro', erro: 'Disco cheio' },
    ]);
  });

  it('só itens com erro: não reserva nada', async () => {
    const t = deps([
      { pedido, indice: 1 },
      { pedido, indice: 9 },
    ]);
    const resultados = await gerarOps(t.deps);
    expect(resultados.map((r) => r.erro)).toEqual([
      ERRO_SEM_INSUMOS,
      'Item não encontrado no pedido',
    ]);
    expect(t.reservas).toEqual([]);
  });
});

describe('montarOrdem', () => {
  it('sem data prevista, a Previsão final fica ausente', () => {
    const ordem = montarOrdem({
      pedido: { ...pedido, dataPrevista: undefined },
      item: pedido.itens[0]!,
      numero: 1,
      data: HOJE,
      empresa: 'Roma Embalagens',
    });
    expect(ordem.previsaoFinal).toBeUndefined();
    expect(ordem.arte).toBeUndefined();
  });

  it('sem pré-preenchimento, data de entrega, processo e observação ficam ausentes', () => {
    const ordem = montarOrdem({
      pedido,
      item: pedido.itens[0]!,
      numero: 1,
      data: HOJE,
      empresa: 'Roma Embalagens',
    });
    expect(ordem.dataEntrega).toBeUndefined();
    expect(ordem.processo).toBeUndefined();
    expect(ordem.observacao).toBeUndefined();
  });

  it('aplica o pré-preenchimento, com as datas como data local', () => {
    const ordem = montarOrdem({
      pedido,
      item: pedido.itens[0]!,
      numero: 1,
      data: HOJE,
      empresa: 'Roma Embalagens',
      preenchimento: {
        dataEntrega: '2026-11-20',
        processo: [
          {
            aplica: 'sim',
            quantidade: '1000',
            responsavel: 'Operador Ficticio',
            data: '2026-11-03',
          },
          {},
        ],
        observacao: 'Fundo e tampa juntos',
      },
    });
    expect(ordem.dataEntrega).toEqual(new Date(2026, 10, 20));
    expect(ordem.processo).toEqual([
      {
        aplica: 'sim',
        quantidade: '1000',
        responsavel: 'Operador Ficticio',
        data: new Date(2026, 10, 3),
      },
      {},
    ]);
    expect(ordem.observacao).toBe('Fundo e tampa juntos');
  });
});
