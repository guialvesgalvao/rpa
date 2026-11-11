import { describe, expect, it } from 'vitest';

import { ErroRequisicao } from '../../../src/app/plataforma/artes.js';
import { ErroIndisponivel, ErroRecusado } from '../../../src/app/plataforma/cliente.js';
import { criarClienteCompras } from '../../../src/app/plataforma/compras.js';

// Dados sintéticos: ids e nomes fictícios.
const PEDIDO = '11111111-1111-4111-8111-111111111111';
const INSUMO = { id: '22222222-2222-4222-8222-222222222222', codigo: 'TPP001', nome: 'Tinta' };
const PESSOA = { id: '33333333-3333-4333-8333-333333333333', nome: 'Pessoa Ficticia' };

const pedido = {
  id: PEDIDO,
  insumo: INSUMO,
  quantidade: 2.5,
  observacao: null,
  status: 'aberta',
  criador: PESSOA,
  areaCriador: 'producao',
  responsavel: null,
  criadoEm: '2026-11-11T12:00:00.000Z',
  atualizadoEm: '2026-11-11T12:00:00.000Z',
};

const json = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { 'content-type': 'application/json' } });

type Chamada = { url: string; metodo: string; corpo: unknown; headers: Record<string, string> };

function api(responder: (url: string) => Response) {
  const chamadas: Chamada[] = [];
  const fake = (async (url: string | URL | Request, init?: RequestInit) => {
    chamadas.push({
      url: String(url),
      metodo: init?.method ?? 'GET',
      corpo: typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body,
      headers: (init?.headers ?? {}) as Record<string, string>,
    });
    return responder(String(url));
  }) as typeof fetch;
  return {
    chamadas,
    cliente: criarClienteCompras({
      baseUrl: 'http://api.local/',
      fetch: fake,
      obterAcesso: async () => 'acesso-1',
    }),
  };
}

const BASE = 'http://api.local/v1/empresas/roma/compras';

describe('cliente de Compras', () => {
  it('lista com escopo e status, autenticado', async () => {
    const { chamadas, cliente } = api(() => json([pedido]));
    const lista = await cliente.listar('roma', { escopo: 'todos', status: 'aberta' });
    expect(lista).toHaveLength(1);
    expect(chamadas[0]?.url).toBe(`${BASE}/pedidos?escopo=todos&status=aberta`);
    expect(chamadas[0]?.headers.authorization).toBe('Bearer acesso-1');
  });

  it('cria, edita, assume e muda o status nas rotas certas, com JSON', async () => {
    const { chamadas, cliente } = api(() => json(pedido));
    await cliente.criar('roma', { insumoId: INSUMO.id, quantidade: 2.5 });
    await cliente.editar('roma', PEDIDO, { quantidade: 3 });
    await cliente.assumir('roma', PEDIDO);
    await cliente.mudarStatus('roma', PEDIDO, 'concluida');
    expect(chamadas.map(({ metodo, url, corpo }) => [metodo, url, corpo])).toEqual([
      ['POST', `${BASE}/pedidos`, { insumoId: INSUMO.id, quantidade: 2.5 }],
      ['PATCH', `${BASE}/pedidos/${PEDIDO}`, { quantidade: 3 }],
      ['POST', `${BASE}/pedidos/${PEDIDO}/assumir`, undefined],
      ['PATCH', `${BASE}/pedidos/${PEDIDO}/status`, { status: 'concluida' }],
    ]);
    expect(chamadas[0]?.headers['content-type']).toBe('application/json');
  });

  it('insumos, detalhe e histórico seguem o contrato', async () => {
    const respostas: Record<string, unknown> = {
      [`${BASE}/insumos`]: [INSUMO],
      [`${BASE}/pedidos/${PEDIDO}`]: { ...pedido, comentarios: [] },
      [`${BASE}/pedidos/${PEDIDO}/historico`]: [
        {
          id: PEDIDO,
          dados: { tipo: 'criacao' },
          autor: PESSOA,
          criadoEm: '2026-11-11T12:00:00.000Z',
        },
      ],
    };
    const { cliente } = api((url) => json(respostas[url]));
    expect(await cliente.insumos('roma')).toEqual([INSUMO]);
    expect((await cliente.obter('roma', PEDIDO)).comentarios).toEqual([]);
    expect((await cliente.historico('roma', PEDIDO))[0]?.dados).toEqual({ tipo: 'criacao' });
  });

  it('comentário com anexos vai em multipart, sem content-type JSON', async () => {
    const comentario = { id: PEDIDO, autor: PESSOA, texto: '', anexos: [], criadoEm: pedido.criadoEm };
    const { chamadas, cliente } = api(() => json(comentario, 201));
    const form = new FormData();
    form.append('texto', 'oi');
    await cliente.comentarComAnexos('roma', PEDIDO, form);
    expect(chamadas[0]?.url).toBe(`${BASE}/pedidos/${PEDIDO}/comentarios`);
    expect(chamadas[0]?.corpo).toBe(form);
    expect(chamadas[0]?.headers['content-type']).toBeUndefined();
  });

  it('erros: 4xx com a mensagem da API, 403 recusado, 5xx e fora do contrato indisponível', async () => {
    const erro = (status: number) =>
      json({ erro: { codigo: 'pedido_encerrado', mensagem: 'O pedido já terminou.' } }, status);
    await expect(api(() => erro(409)).cliente.assumir('roma', PEDIDO)).rejects.toBeInstanceOf(
      ErroRequisicao,
    );
    await expect(api(() => erro(403)).cliente.assumir('roma', PEDIDO)).rejects.toBeInstanceOf(
      ErroRecusado,
    );
    await expect(api(() => erro(500)).cliente.assumir('roma', PEDIDO)).rejects.toBeInstanceOf(
      ErroIndisponivel,
    );
    await expect(
      api(() => json({ outro: 1 })).cliente.obter('roma', PEDIDO),
    ).rejects.toBeInstanceOf(ErroIndisponivel);
  });
});
