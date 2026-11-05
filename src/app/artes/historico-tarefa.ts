import type { TarefasApi } from '../api.js';
import { type Tarefa, tituloTarefa } from '../plataforma/contratos.js';
import { blocoErro, botao, criar, mensagemErro } from './dom.js';
import { descreverEvento, formatarDataHora } from './tarefas-dados.js';

export type DepsHistorico = {
  api: Pick<TarefasApi, 'historico'>;
  tarefa: Pick<Tarefa, 'id' | 'cliente' | 'produto'>;
  voltar: () => void;
};

/** Histórico da tarefa: cada mudança de status com data/hora e autor, da criação até hoje. */
export function montarHistorico(
  raiz: HTMLElement,
  { api, tarefa, voltar }: DepsHistorico,
): { encerrar(): void } {
  let encerrado = false;
  const card = criar('div', 'card');
  raiz.append(card);

  async function carregar() {
    card.replaceChildren(criar('div', 'hint', 'Carregando…'));
    try {
      const eventos = await api.historico(tarefa.id);
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
          criar('td', undefined, descreverEvento(evento)),
          criar('td', undefined, evento.autor?.nome ?? 'Usuário removido'),
        );
        tbody.append(tr);
      }
      tabela.append(thead, tbody);
      const topo = criar('div', 'artes-topo');
      topo.append(botao('Voltar', voltar));
      card.replaceChildren(
        topo,
        criar('h2', undefined, `Histórico — ${tituloTarefa(tarefa)}`),
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
