import type { ComprasApi, PedidoCompraTela } from '../api.js';
import { blocoComentarios } from '../artes/comentarios.js';
import { blocoErro, botao, criar, mensagemErro } from '../artes/dom.js';
import { formatarDataHora } from '../artes/tarefas-dados.js';
import {
  formatarQuantidade,
  ROTULOS_STATUS_COMPRA,
  rotuloArea,
  rotuloInsumo,
  STATUS_COMPRA,
  type StatusCompra,
} from '../plataforma/contratos.js';
import { seloStatusCompra } from './pedidos.js';

export type DepsPedido = {
  api: Pick<
    ComprasApi,
    'obter' | 'assumir' | 'mudarStatus' | 'comentar' | 'escolherAnexos' | 'baixarAnexo'
  >;
  pedidoId: string;
  /** Mensagem de sucesso no topo (ex.: "Pedido criado"). */
  sucesso?: string;
  voltar: () => void;
  editar: (pedido: PedidoCompraTela) => void;
  historico: (pedido: PedidoCompraTela) => void;
};

function campoInfo(rotulo: string, valor: string | HTMLElement): HTMLElement {
  const linha = criar('div', 'tarefa-info-linha');
  const conteudo = typeof valor === 'string' ? criar('span', undefined, valor) : valor;
  linha.append(criar('span', 'tarefa-info-rotulo', rotulo), conteudo);
  return linha;
}

/**
 * Detalhe do pedido de compra: dados, as ações que o usuário pode fazer (assumir, mudar o status, editar, cancelar
 * o próprio pedido ainda Aberto), comentários com anexo e o link do histórico.
 */
export function montarPedido(
  raiz: HTMLElement,
  { api, pedidoId, sucesso, voltar, editar, historico }: DepsPedido,
): { encerrar(): void } {
  let encerrado = false;
  const card = criar('div', 'card');
  raiz.append(card);

  async function carregar(mensagem = sucesso) {
    card.replaceChildren(criar('div', 'hint', 'Carregando…'));
    try {
      const pedido = await api.obter(pedidoId);
      if (encerrado) return;
      desenhar(pedido, mensagem);
    } catch (erro) {
      if (encerrado) return;
      card.replaceChildren(
        botao('Voltar', voltar),
        blocoErro(mensagemErro(erro), () => void carregar()),
      );
    }
  }

  function desenhar(pedido: PedidoCompraTela, mensagem?: string) {
    const erroGeral = criar('div', 'hint warn');
    erroGeral.setAttribute('role', 'alert');
    const { acoes } = pedido;

    // Executa a ação e recarrega o pedido com a mensagem; na falha, devolve o controle e mostra o erro.
    const executar = async (
      acao: () => Promise<unknown>,
      feito: string,
      controle: HTMLButtonElement | HTMLSelectElement,
      aoFalhar?: () => void,
    ) => {
      controle.disabled = true;
      erroGeral.textContent = '';
      try {
        await acao();
        if (!encerrado) await carregar(feito);
      } catch (erro) {
        controle.disabled = false;
        aoFalhar?.();
        erroGeral.textContent = mensagemErro(erro);
      }
    };

    const info = criar('div', 'tarefa-info');
    info.append(
      campoInfo('Insumo', rotuloInsumo(pedido.insumo)),
      campoInfo('Quantidade', formatarQuantidade(pedido.quantidade)),
      campoInfo('Observação', pedido.observacao ?? '—'),
      campoInfo(
        'Pedido por',
        `${pedido.criador?.nome ?? 'Usuário removido'} (${rotuloArea(pedido.areaCriador)})`,
      ),
      campoInfo('Pedido em', formatarDataHora(pedido.criadoEm)),
      campoInfo('Responsável', pedido.responsavel?.nome ?? 'Ninguém assumiu ainda'),
      campoInfo('Atualizado em', formatarDataHora(pedido.atualizadoEm)),
      campoInfo('Status', seloStatusCompra(pedido)),
    );
    if (acoes.mudarStatus) {
      const status = criar('select');
      status.setAttribute('aria-label', 'Status do pedido');
      for (const s of STATUS_COMPRA) status.append(new Option(ROTULOS_STATUS_COMPRA[s], s));
      status.value = pedido.status;
      status.addEventListener('change', () => {
        const escolhido = status.value as StatusCompra;
        if (escolhido === pedido.status) return;
        void executar(
          () => api.mudarStatus(pedido.id, escolhido),
          'Status atualizado',
          status,
          () => (status.value = pedido.status),
        );
      });
      info.append(campoInfo('Mudar status', status));
    }

    const botoes = criar('div', 'actions');
    if (acoes.assumir) {
      const assumir = botao(
        'Assumir',
        () => void executar(() => api.assumir(pedido.id), 'Pedido assumido', assumir),
        'primary',
      );
      botoes.append(assumir);
    }
    if (acoes.editar) botoes.append(botao('Editar', () => editar(pedido)));
    if (acoes.cancelar) {
      const cancelar = botao('Cancelar pedido', () => {
        if (!window.confirm('Cancelar este pedido de compra?')) return;
        void executar(() => api.mudarStatus(pedido.id, 'cancelada'), 'Pedido cancelado', cancelar);
      });
      botoes.append(cancelar);
    }
    botoes.append(botao('Histórico', () => historico(pedido)));

    const comentarios = blocoComentarios({
      comentarios: pedido.comentarios,
      comentar: (texto, anexoIds) => api.comentar(pedido.id, texto, anexoIds),
      escolherAnexos: () => api.escolherAnexos(),
      baixar: (comentarioId, anexo) =>
        api.baixarAnexo({ pedidoId: pedido.id, comentarioId, anexoId: anexo.id, nome: anexo.nome }),
      encerrado: () => encerrado,
    });

    const topo = criar('div', 'artes-topo');
    topo.append(botao('Voltar', voltar));
    card.replaceChildren(
      topo,
      criar('h2', undefined, `Pedido — ${rotuloInsumo(pedido.insumo)}`),
      ...(mensagem ? [criar('div', 'artes-sucesso', mensagem)] : []),
      info,
      erroGeral,
      botoes,
      comentarios,
    );
  }

  void carregar();

  return {
    encerrar() {
      encerrado = true;
      card.remove();
    },
  };
}
