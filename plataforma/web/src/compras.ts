import {
  type EscopoCompras,
  EsquemaQuantidadeCompra,
  type Insumo,
  type PedidoCompra,
  pedidoEditavel,
  STATUS_COMPRA,
  type StatusCompra,
  temPermissao,
} from '@plataforma/contratos';

// Regras de tela do módulo Compras. A API confere tudo de novo: isto só evita mostrar o que não funcionaria.

export type FiltroEscopo = { valor: EscopoCompras; rotulo: string };

/** Escopos da lista. "Todos" só para quem acompanha (os demais só alcançam os próprios pedidos). */
export function escoposDaLista(permissoes: readonly string[]): FiltroEscopo[] {
  const escopos: FiltroEscopo[] = [
    { valor: 'meus', rotulo: 'Meus pedidos' },
    { valor: 'abertos', rotulo: 'Em aberto' },
  ];
  if (temPermissao(permissoes, 'compras.acompanhar'))
    escopos.push({ valor: 'todos', rotulo: 'Todos' });
  return escopos;
}

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

export type AcoesPermitidas = {
  assumir: boolean;
  mudarStatus: boolean;
  editar: boolean;
  cancelar: boolean;
};

/**
 * O que quem vê o pedido pode fazer nele, pelas regras da API: quem acompanha assume (se ainda não é o responsável
 * em andamento), muda o status e edita; o criador com `compras.pedir` edita e cancela o próprio pedido enquanto
 * está Aberta. Editar e assumir só enquanto o pedido não terminou.
 */
export function acoesDoPedido(
  pedido: Pick<PedidoCompra, 'status' | 'criador' | 'responsavel'>,
  usuarioId: string,
  permissoes: readonly string[],
): AcoesPermitidas {
  const acompanha = temPermissao(permissoes, 'compras.acompanhar');
  const ehCriador = pedido.criador?.id === usuarioId;
  const editavel = pedidoEditavel(pedido);
  const jaEhMeu = pedido.responsavel?.id === usuarioId && pedido.status === 'em_andamento';
  return {
    assumir: acompanha && editavel && !jaEhMeu,
    mudarStatus: acompanha,
    editar: editavel && (acompanha || (ehCriador && temPermissao(permissoes, 'compras.pedir'))),
    cancelar: !acompanha && ehCriador && pedido.status === 'aberta',
  };
}

const normalizar = (texto: string) =>
  texto.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();

/** Busca no código e no nome do insumo, sem diferenciar maiúsculas nem acentos. */
export function filtrarInsumos(insumos: readonly Insumo[], termo: string): Insumo[] {
  const busca = normalizar(termo);
  if (!busca) return [...insumos];
  return insumos.filter((insumo) => normalizar(`${insumo.codigo} ${insumo.nome}`).includes(busca));
}

/**
 * Quantidade digitada no formato brasileiro ("1,5" ou "1.234,5") ou com ponto decimal ("1.5"). `undefined` quando
 * não é um número positivo com até 3 casas decimais.
 */
export function lerQuantidade(texto: string): number | undefined {
  const limpo = texto.trim().replace(/\s/g, '');
  if (!/^\d[\d.,]*$/.test(limpo)) return undefined;
  let normalizado: string;
  if (limpo.includes(',')) {
    // Vírgula decimal: os pontos são de milhar.
    if (limpo.indexOf(',') !== limpo.lastIndexOf(',')) return undefined;
    normalizado = limpo.replace(/\./g, '').replace(',', '.');
  } else {
    // Sem vírgula: um ponto só é decimal; mais de um, não vale.
    if (limpo.indexOf('.') !== limpo.lastIndexOf('.')) return undefined;
    normalizado = limpo;
  }
  const valor = Number(normalizado);
  const conferido = EsquemaQuantidadeCompra.safeParse(valor);
  return conferido.success ? conferido.data : undefined;
}

/** O texto inicial do campo de quantidade na edição: "12,5". */
export const quantidadeParaCampo = (quantidade: number): string =>
  String(quantidade).replace('.', ',');
