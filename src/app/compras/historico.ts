import type { ComprasApi } from '../api.js';
import { blocoErro, botao, criar, mensagemErro } from '../artes/dom.js';
import { formatarDataHora } from '../artes/tarefas-dados.js';
import { descreverEventoCompra, type PedidoCompra, rotuloInsumo } from '../plataforma/contratos.js';

export type DepsHistoricoPedido = {
  api: Pick<ComprasApi, 'historico'>;
  pedido: Pick<PedidoCompra, 'id' | 'insumo'>;
  voltar: () => void;
};

/** Histórico do pedido: criação, responsável, status e edições, com data/hora e autor. */
export function montarHistoricoPedido(
  raiz: HTMLElement,
  { api, pedido, voltar }: DepsHistoricoPedido,
): { encerrar(): void } {
  let encerrado = false;
  const card = criar('div', 'card');
  raiz.append(card);

  async function carregar() {
    card.replaceChildren(criar('div', 'hint', 'Carregando…'));
    try {
      const eventos = await api.historico(pedido.id);
      if (encerrado) return;
      const tabela = criar('table', 'tarefa-historico');
      const cabecalho = criar('tr');
      for (const rotulo of ['Data/hora', 'Mudança', 'Por']) {
        cabecalho.append(criar('th', undefined, rotulo));
      }
      const thead = criar('thead');
      thead.append(cabecalho);
      const tbody = criar('tbody');
      for (const evento of eventos) {
        const tr = criar('tr');
        tr.append(
          criar('td', undefined, formatarDataHora(evento.criadoEm)),
          criar('td', undefined, descreverEventoCompra(evento.dados)),
          criar('td', undefined, evento.autor?.nome ?? 'Usuário removido'),
        );
        tbody.append(tr);
      }
      tabela.append(thead, tbody);
      const topo = criar('div', 'artes-topo');
      topo.append(botao('Voltar', voltar));
      card.replaceChildren(
        topo,
        criar('h2', undefined, `Histórico — ${rotuloInsumo(pedido.insumo)}`),
        tabela,
      );
    } catch (erro) {
      if (encerrado) return;
      card.replaceChildren(
        botao('Voltar', voltar),
        blocoErro(mensagemErro(erro), () => void carregar()),
      );
    }
  }

  void carregar();

  return {
    encerrar() {
      encerrado = true;
      card.remove();
    },
  };
}
