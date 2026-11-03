import type { ItemOpTela, PedidoOpTela } from '../api.js';
import { botao, criar } from '../artes/dom.js';
import { renderPassos } from '../resultados.js';
import {
  chaveItem,
  descreverArte,
  type EscolhaItem,
  nomeDoCliente,
  podeGerar,
  rotuloArte,
} from './lista.js';

type PedidoOk = Extract<PedidoOpTela, { situacao: 'ok' }>;

export type DepsListaOp = {
  pedidos: readonly PedidoOpTela[];
  escolhas: Map<string, EscolhaItem>;
  /** Uma execução está em andamento: nada muda. */
  bloqueado: boolean;
  aoMudar: () => void;
  novaArte: (pedido: PedidoOk, item: ItemOpTela) => void;
};

const SEM_ARTE = '';

/** Ícone de info com a cor e as máquinas da arte escolhida (no `title` e para leitor de tela). */
function iconeInfo(): { el: HTMLElement; mostrar(texto: string | undefined): void } {
  const el = criar('span', 'op-info', 'ⓘ');
  el.tabIndex = 0;
  el.setAttribute('role', 'img');
  return {
    el,
    mostrar(texto) {
      el.hidden = !texto;
      el.title = texto ?? '';
      el.setAttribute('aria-label', texto ?? '');
    },
  };
}

function linhaDoItem(pedido: PedidoOk, item: ItemOpTela, deps: DepsListaOp): HTMLElement {
  const escolha = deps.escolhas.get(chaveItem(pedido.numero, item.indice)) ?? { marcado: false };
  const linha = criar('div', 'op-item');
  const gera = podeGerar(item);
  linha.classList.toggle('desmarcado', !escolha.marcado);

  const rotulo = criar('label', 'check');
  const check = criar('input');
  check.type = 'checkbox';
  check.checked = gera && escolha.marcado;
  check.disabled = deps.bloqueado || !gera;
  check.addEventListener('change', () => {
    escolha.marcado = check.checked;
    linha.classList.toggle('desmarcado', !check.checked);
    deps.aoMudar();
  });
  const quantidade = `${item.quantidade.toLocaleString('pt-BR')} ${item.unidade}`.trim();
  rotulo.append(check, `${item.codigo} — ${item.descricao} (${quantidade})`);
  linha.append(rotulo);

  if (!gera) {
    linha.append(criar('div', 'erro-msg op-item-erro', item.erro ?? 'Produto sem OP'));
    return linha;
  }

  const arte = criar('div', 'op-arte');
  const info = iconeInfo();
  if (item.artes.length) {
    const seletor = criar('select');
    seletor.disabled = deps.bloqueado;
    seletor.setAttribute('aria-label', `Arte de ${item.codigo}`);
    for (const a of item.artes) seletor.append(new Option(rotuloArte(a), a.id));
    seletor.append(new Option('Sem arte', SEM_ARTE));
    seletor.value = escolha.arteId ?? SEM_ARTE;
    const atualizarInfo = () => {
      const atual = item.artes.find((a) => a.id === seletor.value);
      info.mostrar(atual && descreverArte(atual));
    };
    seletor.addEventListener('change', () => {
      escolha.arteId = seletor.value || undefined;
      atualizarInfo();
      deps.aoMudar();
    });
    atualizarInfo();
    arte.append(criar('span', 'op-arte-rotulo', 'Arte:'), seletor, info.el);
  } else {
    info.mostrar(undefined);
    arte.append(criar('span', 'hint op-sem-arte', 'Sem arte cadastrada: a OP sai sem a arte.'));
  }
  if (pedido.cliente) {
    const nova = botao('Nova arte', () => deps.novaArte(pedido, item), 'op-nova-arte');
    nova.disabled = deps.bloqueado;
    arte.append(nova);
  }
  linha.append(arte);
  return linha;
}

/** Lista Pedido → Produto: checkbox por produto, arte pré-selecionada e cadastro de nova arte. */
export function renderPedidos(raiz: HTMLElement, deps: DepsListaOp): void {
  const blocos = deps.pedidos.map((pedido) => {
    const bloco = criar('div', 'pedido op-pedido');
    if (pedido.situacao === 'erro') {
      bloco.append(
        criar('div', 'op-pedido-titulo', `Pedido ${pedido.numero}`),
        criar('div', 'erro-msg', pedido.erro),
      );
      if (pedido.passos.length) bloco.append(renderPassos(pedido.passos, pedido.erro));
      return bloco;
    }
    const prevista = pedido.dataPrevista ? ` · Prevista: ${pedido.dataPrevista}` : '';
    bloco.append(
      criar('div', 'op-pedido-titulo', `Pedido ${pedido.numero} — ${nomeDoCliente(pedido)}`),
      criar('div', 'hint op-pedido-datas', `Venda: ${pedido.dataVenda}${prevista}`),
    );
    if (pedido.aviso) bloco.append(criar('div', 'hint warn', pedido.aviso));
    if (!pedido.itens.length) {
      bloco.append(criar('div', 'hint', 'Nenhum produto neste pedido.'));
    }
    for (const item of pedido.itens) bloco.append(linhaDoItem(pedido, item, deps));
    return bloco;
  });
  raiz.replaceChildren(...blocos);
}
