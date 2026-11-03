import type { ItemOpTela, ItemParaGerarOp, PedidoOpTela } from '../api.js';
import type { ArteDoProduto } from '../plataforma/contratos.js';

/** Escolha do usuário para um produto: gerar ou não a OP, e com qual arte (vazio = sem arte). */
export type EscolhaItem = { marcado: boolean; arteId?: string };

export const chaveItem = (numero: string, indice: number): string => `${numero}:${indice}`;

/**
 * Arte pré-selecionada: a única, ou a mais nova (`criadoEm`). Empate de data: a que vem primeiro
 * na lista (a API já ordena da mais nova para a mais antiga). Sem arte: `undefined`.
 */
export function artePreSelecionada(artes: readonly ArteDoProduto[]): ArteDoProduto | undefined {
  let escolhida: ArteDoProduto | undefined;
  for (const arte of artes) {
    if (!escolhida || Date.parse(arte.criadoEm) > Date.parse(escolhida.criadoEm)) escolhida = arte;
  }
  return escolhida;
}

/** Item com erro (sem insumos) aparece, mas não gera OP. */
export const podeGerar = (item: ItemOpTela): boolean => !item.erro;

/**
 * Escolhas da lista Pedido → Produto: produto que gera OP entra marcado com a arte pré-selecionada;
 * produto com erro fica desmarcado. Um produto que já estava na lista mantém a escolha anterior, se
 * a arte ainda existir.
 */
export function montarEscolhas(
  pedidos: readonly PedidoOpTela[],
  anteriores: ReadonlyMap<string, EscolhaItem> = new Map(),
): Map<string, EscolhaItem> {
  const escolhas = new Map<string, EscolhaItem>();
  for (const pedido of pedidos) {
    if (pedido.situacao !== 'ok') continue;
    for (const item of pedido.itens) {
      const chave = chaveItem(pedido.numero, item.indice);
      if (!podeGerar(item)) {
        escolhas.set(chave, { marcado: false });
        continue;
      }
      const anterior = anteriores.get(chave);
      const arteValida =
        anterior && (!anterior.arteId || item.artes.some((a) => a.id === anterior.arteId));
      escolhas.set(
        chave,
        arteValida
          ? { ...anterior }
          : { marcado: anterior?.marcado ?? true, arteId: artePreSelecionada(item.artes)?.id },
      );
    }
  }
  return escolhas;
}

/** Produtos marcados (e que geram OP), na ordem da lista, com a arte escolhida. */
export function itensParaGerar(
  pedidos: readonly PedidoOpTela[],
  escolhas: ReadonlyMap<string, EscolhaItem>,
): ItemParaGerarOp[] {
  const itens: ItemParaGerarOp[] = [];
  for (const pedido of pedidos) {
    if (pedido.situacao !== 'ok') continue;
    for (const item of pedido.itens) {
      const escolha = escolhas.get(chaveItem(pedido.numero, item.indice));
      if (!escolha?.marcado || !podeGerar(item)) continue;
      itens.push({
        numero: pedido.numero,
        indice: item.indice,
        ...(escolha.arteId ? { arteId: escolha.arteId } : {}),
      });
    }
  }
  return itens;
}

/** Contagem para o resumo da seleção. */
export function resumirSelecao(
  pedidos: readonly PedidoOpTela[],
  escolhas: ReadonlyMap<string, EscolhaItem>,
): string {
  const itens = itensParaGerar(pedidos, escolhas);
  const semArte = itens.filter((i) => !i.arteId).length;
  const base = `${itens.length} OP(s) selecionada(s)`;
  return semArte ? `${base}, ${semArte} sem arte` : base;
}

/** Ex.: "Cor: Azul · Máquinas: Favorit, Rekord". */
export const descreverArte = (arte: ArteDoProduto): string =>
  `Cor: ${arte.cor.nome} · Máquinas: ${arte.maquinas.map((m) => m.nome).join(', ') || '—'}`;

const doisDigitos = (n: number) => String(n).padStart(2, '0');

/** Ex.: "Padrão — 30/10/2026" (data local do cadastro). */
export function rotuloArte(arte: ArteDoProduto): string {
  const d = new Date(arte.criadoEm);
  return `${arte.nome} — ${doisDigitos(d.getDate())}/${doisDigitos(d.getMonth() + 1)}/${d.getFullYear()}`;
}

/** Cliente como aparece no pedido: fantasia, senão o nome. */
export function nomeDoCliente(pedido: Extract<PedidoOpTela, { situacao: 'ok' }>): string {
  return pedido.clienteFantasia?.trim() || pedido.clienteNome;
}
