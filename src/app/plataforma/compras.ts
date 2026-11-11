import { z } from 'zod';

import { criarRequisicoes, type DepsClienteArtes } from './artes.js';
import {
  type ComentarioCompra,
  type EdicaoPedidoCompra,
  type EscopoCompras,
  EsquemaComentarioCompra,
  EsquemaEventoCompra,
  EsquemaInsumo,
  EsquemaPedidoCompra,
  EsquemaPedidoCompraDetalhe,
  type EventoCompra,
  type Insumo,
  type NovoPedidoCompra,
  type PedidoCompra,
  type PedidoCompraDetalhe,
  type StatusCompra,
} from './contratos.js';

export type ConsultaComprasApp = { escopo: EscopoCompras; status?: StatusCompra };

/** Pedidos de compra de insumos da empresa (ADR 0012). A API decide o alcance e as ações de cada um. */
export type ClienteCompras = {
  insumos(empresa: string): Promise<Insumo[]>;
  listar(empresa: string, consulta: ConsultaComprasApp): Promise<PedidoCompra[]>;
  obter(empresa: string, id: string): Promise<PedidoCompraDetalhe>;
  criar(empresa: string, novo: NovoPedidoCompra): Promise<PedidoCompra>;
  editar(empresa: string, id: string, edicao: EdicaoPedidoCompra): Promise<PedidoCompra>;
  assumir(empresa: string, id: string): Promise<PedidoCompra>;
  mudarStatus(empresa: string, id: string, status: StatusCompra): Promise<PedidoCompra>;
  comentar(empresa: string, id: string, texto: string): Promise<ComentarioCompra>;
  /** Comentário com anexos (multipart montado por `montarEnvioComentario`). */
  comentarComAnexos(empresa: string, id: string, form: FormData): Promise<ComentarioCompra>;
  baixarAnexo(
    empresa: string,
    pedidoId: string,
    comentarioId: string,
    anexoId: string,
  ): Promise<Uint8Array>;
  historico(empresa: string, id: string): Promise<EventoCompra[]>;
};

// O Railway aceita uploads de até 5 minutos.
const TIMEOUT_ENVIO_PADRAO_MS = 5 * 60_000;

export function criarClienteCompras({
  baseUrl,
  fetch,
  obterAcesso,
  timeoutMs,
  timeoutEnvioMs = TIMEOUT_ENVIO_PADRAO_MS,
}: Omit<DepsClienteArtes, 'agora'>): ClienteCompras {
  const { chamar, lerJson } = criarRequisicoes({
    baseUrl,
    fetch,
    obterAcesso,
    ...(timeoutMs !== undefined && { timeoutMs }),
  });
  const rota = (empresa: string, resto: string) =>
    `/v1/empresas/${encodeURIComponent(empresa)}/compras${resto}`;
  const pedido = (empresa: string, id: string, resto = '') =>
    rota(empresa, `/pedidos/${encodeURIComponent(id)}${resto}`);

  return {
    async insumos(empresa) {
      return lerJson(await chamar('GET', rota(empresa, '/insumos')), z.array(EsquemaInsumo));
    },
    async listar(empresa, { escopo, status }) {
      const params = new URLSearchParams({ escopo });
      if (status) params.set('status', status);
      const resposta = await chamar('GET', rota(empresa, `/pedidos?${params}`));
      return lerJson(resposta, z.array(EsquemaPedidoCompra));
    },
    async obter(empresa, id) {
      return lerJson(await chamar('GET', pedido(empresa, id)), EsquemaPedidoCompraDetalhe);
    },
    async criar(empresa, novo) {
      const resposta = await chamar('POST', rota(empresa, '/pedidos'), { json: novo });
      return lerJson(resposta, EsquemaPedidoCompra);
    },
    async editar(empresa, id, edicao) {
      const resposta = await chamar('PATCH', pedido(empresa, id), { json: edicao });
      return lerJson(resposta, EsquemaPedidoCompra);
    },
    async assumir(empresa, id) {
      return lerJson(await chamar('POST', pedido(empresa, id, '/assumir')), EsquemaPedidoCompra);
    },
    async mudarStatus(empresa, id, status) {
      const resposta = await chamar('PATCH', pedido(empresa, id, '/status'), {
        json: { status },
      });
      return lerJson(resposta, EsquemaPedidoCompra);
    },
    async comentar(empresa, id, texto) {
      const resposta = await chamar('POST', pedido(empresa, id, '/comentarios'), {
        json: { texto },
      });
      return lerJson(resposta, EsquemaComentarioCompra);
    },
    async comentarComAnexos(empresa, id, form) {
      const resposta = await chamar('POST', pedido(empresa, id, '/comentarios'), {
        corpo: form,
        timeout: timeoutEnvioMs,
      });
      return lerJson(resposta, EsquemaComentarioCompra);
    },
    async baixarAnexo(empresa, pedidoId, comentarioId, anexoId) {
      const caminho = pedido(
        empresa,
        pedidoId,
        `/comentarios/${encodeURIComponent(comentarioId)}/anexos/${encodeURIComponent(anexoId)}`,
      );
      const resposta = await chamar('GET', caminho, { timeout: timeoutEnvioMs });
      return new Uint8Array(await resposta.arrayBuffer());
    },
    async historico(empresa, id) {
      const resposta = await chamar('GET', pedido(empresa, id, '/historico'));
      return lerJson(resposta, z.array(EsquemaEventoCompra));
    },
  };
}
