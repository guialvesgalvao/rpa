import 'server-only';

import {
  EsquemaEventoCompra,
  EsquemaInsumo,
  EsquemaPedidoCompra,
  EsquemaPedidoCompraDetalhe,
  type EscopoCompras,
  type EventoCompra,
  type Insumo,
  type PedidoCompra,
  type PedidoCompraDetalhe,
  type StatusCompra,
} from '@plataforma/contratos';
import { z } from 'zod';

import { lerDaApi } from './artes';

const base = (empresa: string) => `/v1/empresas/${encodeURIComponent(empresa)}/compras`;

export function pedidosDaEmpresa(
  empresa: string,
  consulta: { escopo: EscopoCompras; status?: StatusCompra },
): Promise<PedidoCompra[]> {
  const params = new URLSearchParams({ escopo: consulta.escopo });
  if (consulta.status) params.set('status', consulta.status);
  return lerDaApi(`${base(empresa)}/pedidos?${params}`, z.array(EsquemaPedidoCompra));
}

export const pedidoDaEmpresa = (empresa: string, id: string): Promise<PedidoCompraDetalhe> =>
  lerDaApi(`${base(empresa)}/pedidos/${encodeURIComponent(id)}`, EsquemaPedidoCompraDetalhe);

export const historicoDoPedido = (empresa: string, id: string): Promise<EventoCompra[]> =>
  lerDaApi(
    `${base(empresa)}/pedidos/${encodeURIComponent(id)}/historico`,
    z.array(EsquemaEventoCompra),
  );

// Produtos ativos da empresa com código TPP (exige `compras.pedir`).
export const insumosDaEmpresa = (empresa: string): Promise<Insumo[]> =>
  lerDaApi(`${base(empresa)}/insumos`, z.array(EsquemaInsumo));
