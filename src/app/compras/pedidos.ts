import type { ComprasApi } from '../api.js';
import { blocoErro, botao, criar, mensagemErro } from '../artes/dom.js';
import { formatarDataHora } from '../artes/tarefas-dados.js';
import {
  type EscopoCompras,
  escoposDaLista,
  formatarQuantidade,
  type PedidoCompra,
  ROTULOS_STATUS_COMPRA,
  rotuloArea,
  rotuloInsumo,
  STATUS_COMPRA,
  type StatusCompra,
  temPermissao,
} from '../plataforma/contratos.js';

export type DepsPedidos = {
  api: Pick<ComprasApi, 'listar'>;
  permissoes: readonly string[];
  /** Filtro com que a lista abre (o último usado, ao voltar de um pedido). */
  filtro: { escopo: EscopoCompras; status?: StatusCompra };
  aoFiltrar: (filtro: { escopo: EscopoCompras; status?: StatusCompra }) => void;
  novo: () => void;
  abrir: (pedido: PedidoCompra) => void;
};

/** Selo com o status do pedido (a cor vem de `data-status`). */
export function seloStatusCompra(pedido: Pick<PedidoCompra, 'status'>): HTMLElement {
  const selo = criar('span', 'tarefa-status compra-status', ROTULOS_STATUS_COMPRA[pedido.status]);
  selo.dataset.status = pedido.status;
  return selo;
}

/** Ex.: "10 · Pedro Ficticio (Produção) · 05/11/2026 14:32 · Responsável: Ana". */
export function resumoDoPedido(pedido: PedidoCompra): string {
  const criador = pedido.criador?.nome ?? 'Usuário removido';
  return [
    `Quantidade ${formatarQuantidade(pedido.quantidade)}`,
    `${criador} (${rotuloArea(pedido.areaCriador)})`,
    formatarDataHora(pedido.criadoEm),
    `Responsável: ${pedido.responsavel?.nome ?? 'ninguém'}`,
  ].join(' · ');
}

/**
 * Lista de pedidos de compra: escopo (Meus pedidos, Em aberto e, para quem acompanha, Todos) e status, mais recentes
 * primeiro. Quem só pede vê os próprios (a API decide).
 */
export function montarPedidos(
  raiz: HTMLElement,
  { api, permissoes, filtro: inicial, aoFiltrar, novo, abrir }: DepsPedidos,
): { encerrar(): void } {
  let encerrado = false;
  let requisicao = 0;

  const escopo = criar('select', 'tarefas-filtro');
  escopo.setAttribute('aria-label', 'Pedidos');
  for (const { valor, rotulo } of escoposDaLista(permissoes))
    escopo.append(new Option(rotulo, valor));
  escopo.value = inicial.escopo;
  if (!escopo.value) escopo.value = 'meus';
  const status = criar('select', 'tarefas-filtro');
  status.setAttribute('aria-label', 'Filtrar por status');
  status.append(new Option('Todos os status', ''));
  for (const s of STATUS_COMPRA) status.append(new Option(ROTULOS_STATUS_COMPRA[s], s));
  status.value = inicial.status ?? '';

  const lista = criar('ul', 'artes-lista');
  const situacao = criar('div', 'artes-situacao');
  const topo = criar('div', 'artes-topo tarefas-topo');
  if (temPermissao(permissoes, 'compras.pedir')) topo.append(botao('Novo pedido', novo, 'primary'));
  topo.append(escopo, status);
  const card = criar('div', 'card');
  card.append(criar('h2', undefined, 'Pedidos de compra'), topo, lista, situacao);
  raiz.append(card);

  function linha(pedido: PedidoCompra): HTMLElement {
    const item = criar('li');
    const botaoLinha = criar('button', 'artes-item tarefa-item');
    botaoLinha.type = 'button';
    const texto = criar('span', 'tarefa-item-texto');
    texto.append(
      criar('span', 'artes-item-nome', rotuloInsumo(pedido.insumo)),
      criar('span', 'artes-item-cnpj', resumoDoPedido(pedido)),
    );
    botaoLinha.append(texto, seloStatusCompra(pedido));
    botaoLinha.addEventListener('click', () => abrir(pedido));
    item.append(botaoLinha);
    return item;
  }

  const filtroAtual = () => {
    const s = STATUS_COMPRA.find((valor) => valor === status.value);
    const e = escopo.value as EscopoCompras;
    return s ? { escopo: e, status: s } : { escopo: e };
  };

  async function carregar() {
    const minha = ++requisicao;
    const filtro = filtroAtual();
    aoFiltrar(filtro);
    lista.replaceChildren();
    situacao.replaceChildren(criar('div', 'hint', 'Carregando…'));
    try {
      const pedidos = await api.listar(filtro);
      if (encerrado || minha !== requisicao) return;
      lista.replaceChildren(...pedidos.map(linha));
      situacao.replaceChildren(
        ...(pedidos.length ? [] : [criar('div', 'hint', 'Nenhum pedido encontrado.')]),
      );
    } catch (erro) {
      if (encerrado || minha !== requisicao) return;
      situacao.replaceChildren(blocoErro(mensagemErro(erro), () => void carregar()));
    }
  }

  escopo.addEventListener('change', () => void carregar());
  status.addEventListener('change', () => void carregar());
  void carregar();

  return {
    encerrar() {
      encerrado = true;
      card.remove();
    },
  };
}
