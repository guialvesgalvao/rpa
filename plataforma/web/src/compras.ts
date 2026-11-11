import {
  type EscopoCompras,
  escoposDaLista,
  STATUS_COMPRA,
  type StatusCompra,
} from '@plataforma/contratos';

// As regras de tela de Compras ficam nos contratos (site e app); aqui, só o que depende da URL.

/** Escopo e status da URL, só se válidos para quem pede; o padrão é "Meus pedidos" sem status. */
export function consultaDaLista(
  permissoes: readonly string[],
  busca: { escopo?: unknown; status?: unknown },
): { escopo: EscopoCompras; status?: StatusCompra } {
  const escopo =
    escoposDaLista(permissoes).find((opcao) => opcao.valor === busca.escopo)?.valor ?? 'meus';
  const status = STATUS_COMPRA.find((s) => s === busca.status);
  return status ? { escopo, status } : { escopo };
}
