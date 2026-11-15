import { describe, expect, it } from 'vitest';

import {
  CLIENTE_FINAL_MAX,
  chaveClienteFinal,
  clienteFinalDoPedido,
  EsquemaArteDoProduto,
  EsquemaNovaTarefa,
  EsquemaTarefa,
  FILTRO_CLIENTE_FINAL_TODOS,
  FILTRO_SEM_CLIENTE_FINAL,
  filtrarPorClienteFinal,
  limparClienteFinal,
  opcoesFiltroClienteFinal,
  seloClienteFinal,
  tituloTarefa,
  validarClienteFinal,
  validarNovaArte,
} from '../src/index.ts';

const revenda = { razaoSocial: 'Revenda Ficticia Ltda', nomeFantasia: 'Revenda Ficticia' };

describe('cliente final de revenda', () => {
  it('limpa espaços e trata vazio como ausente', () => {
    expect(limparClienteFinal('  Pizzaria   Fictícia ')).toBe('Pizzaria Fictícia');
    expect(limparClienteFinal('   ')).toBeNull();
    expect(limparClienteFinal(null)).toBeNull();
    expect(limparClienteFinal(undefined)).toBeNull();
  });

  it('chave sem acento, maiúsculas nem espaços repetidos', () => {
    expect(chaveClienteFinal(' PIZZARIA  Fictícia ')).toBe('pizzaria ficticia');
    expect(chaveClienteFinal('Açaí do João')).toBe(chaveClienteFinal('acai do joao'));
  });

  it('cliente final do pedido', () => {
    expect(clienteFinalDoPedido('Pizzaria Fictícia', revenda)).toBe('Pizzaria Fictícia');
    expect(clienteFinalDoPedido(' Pizzaria  Fictícia ', revenda)).toBe('Pizzaria Fictícia');
    expect(clienteFinalDoPedido('', revenda)).toBeNull();
    expect(clienteFinalDoPedido(null, revenda)).toBeNull();
    // O próprio cliente (razão social ou fantasia, sem acento nem maiúsculas) não é cliente final.
    expect(clienteFinalDoPedido('REVENDA FICTÍCIA', revenda)).toBeNull();
    expect(clienteFinalDoPedido('revenda ficticia ltda', revenda)).toBeNull();
    expect(
      clienteFinalDoPedido('Revenda Ficticia', {
        razaoSocial: 'Revenda Ficticia',
        nomeFantasia: null,
      }),
    ).toBeNull();
    expect(clienteFinalDoPedido('x'.repeat(200), revenda)).toHaveLength(CLIENTE_FINAL_MAX);
  });

  it('valida o tamanho', () => {
    expect(validarClienteFinal(undefined)).toBeNull();
    expect(validarClienteFinal('x'.repeat(CLIENTE_FINAL_MAX))).toBeNull();
    expect(validarClienteFinal('x'.repeat(CLIENTE_FINAL_MAX + 1))).toMatch(/120/);
    const base = {
      produtoId: 'p',
      corId: 'c',
      maquinaIds: ['m'],
      pdf: { tamanho: 1, tipo: 'pdf' as const },
    };
    expect(validarNovaArte({ ...base, clienteFinal: 'x'.repeat(121) }).clienteFinal).toBeDefined();
    expect(validarNovaArte({ ...base, clienteFinal: 'Pizzaria' })).toEqual({});
  });

  it('corpo da criação manual da tarefa', () => {
    expect(EsquemaNovaTarefa.parse({})).toEqual({ clienteFinal: null });
    expect(EsquemaNovaTarefa.parse({ clienteFinal: '  ' })).toEqual({ clienteFinal: null });
    expect(EsquemaNovaTarefa.parse({ clienteFinal: ' Pizzaria ' })).toEqual({
      clienteFinal: 'Pizzaria',
    });
    expect(EsquemaNovaTarefa.safeParse({ clienteFinal: 'x'.repeat(121) }).success).toBe(false);
  });

  it('título com e sem cliente final', () => {
    const base = {
      cliente: { id: 'c', nome: 'Revenda Ficticia' },
      produto: { id: 'p', nome: 'Caixa de Pizza' },
    };
    expect(tituloTarefa({ ...base, clienteFinal: 'Pizzaria Ficticia' })).toBe(
      'Arte de Caixa de Pizza para Pizzaria Ficticia (Revenda Ficticia)',
    );
    expect(tituloTarefa({ ...base, clienteFinal: null })).toBe(
      'Arte de Caixa de Pizza para Revenda Ficticia',
    );
  });

  it('respostas de uma API anterior ficam sem cliente final', () => {
    const tarefa = EsquemaTarefa.parse({
      id: '00000000-0000-4000-8000-000000000001',
      cliente: { id: '00000000-0000-4000-8000-000000000002', nome: 'C' },
      produto: { id: '00000000-0000-4000-8000-000000000003', nome: 'P' },
      responsavel: null,
      status: 'nao_iniciada',
      arteId: null,
      criadoEm: '2026-11-15T00:00:00.000Z',
      atualizadoEm: '2026-11-15T00:00:00.000Z',
    });
    expect(tarefa.clienteFinal).toBeNull();
    const arte = EsquemaArteDoProduto.parse({
      id: '00000000-0000-4000-8000-000000000004',
      nome: 'Padrão',
      cor: { id: '00000000-0000-4000-8000-000000000005', nome: '4x4' },
      maquinas: [],
      criadoEm: '2026-11-15T00:00:00.000Z',
      temPdf: true,
      temImagem: false,
    });
    expect(arte).toMatchObject({ clienteFinal: null, pedidoNumero: null });
  });

  it('selo da arte', () => {
    expect(seloClienteFinal({ clienteFinal: null, pedidoNumero: '10' })).toBeNull();
    expect(seloClienteFinal({ clienteFinal: 'Pizzaria', pedidoNumero: null })).toBe(
      'Cliente final: Pizzaria',
    );
    expect(seloClienteFinal({ clienteFinal: 'Pizzaria', pedidoNumero: '10' })).toBe(
      'Cliente final: Pizzaria · Pedido nº 10',
    );
  });

  it('filtro por cliente final', () => {
    const artes = [
      { id: 1, clienteFinal: 'Pizzaria Fictícia' },
      { id: 2, clienteFinal: null },
      { id: 3, clienteFinal: 'pizzaria ficticia' },
      { id: 4, clienteFinal: 'Hamburgueria Exemplo' },
    ];
    expect(opcoesFiltroClienteFinal([{ clienteFinal: null }])).toEqual([]);
    expect(opcoesFiltroClienteFinal(artes)).toEqual([
      { valor: FILTRO_CLIENTE_FINAL_TODOS, rotulo: 'Todos os clientes finais' },
      { valor: 'hamburgueria exemplo', rotulo: 'Hamburgueria Exemplo' },
      { valor: 'pizzaria ficticia', rotulo: 'Pizzaria Fictícia' },
      { valor: FILTRO_SEM_CLIENTE_FINAL, rotulo: 'Sem cliente final' },
    ]);
    expect(filtrarPorClienteFinal(artes, '').map((a) => a.id)).toEqual([1, 2, 3, 4]);
    expect(filtrarPorClienteFinal(artes, 'pizzaria ficticia').map((a) => a.id)).toEqual([1, 3]);
    expect(filtrarPorClienteFinal(artes, FILTRO_SEM_CLIENTE_FINAL).map((a) => a.id)).toEqual([2]);
  });
});
