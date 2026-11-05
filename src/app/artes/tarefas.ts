import type { TarefasApi } from '../api.js';
import {
  type EscopoTarefas,
  ROTULOS_ESCOPO_TAREFAS,
  ROTULOS_STATUS_TAREFA,
  type Tarefa,
  tituloTarefa,
} from '../plataforma/contratos.js';
import { blocoErro, botao, criar, mensagemErro } from './dom.js';
import { filtrosDeTarefas, formatarDataHora } from './tarefas-dados.js';

export type DepsTarefas = {
  api: Pick<TarefasApi, 'listar'>;
  escopo: EscopoTarefas;
  /** Mostra o responsável em cada linha (visão do admin). */
  comResponsavel: boolean;
  voltar: () => void;
  abrir: (tarefa: Tarefa) => void;
};

/** Selo com o status da tarefa (a cor vem de `data-status`). */
export function seloStatus(tarefa: Pick<Tarefa, 'status'>): HTMLElement {
  const selo = criar('span', 'tarefa-status', ROTULOS_STATUS_TAREFA[tarefa.status]);
  selo.dataset.status = tarefa.status;
  return selo;
}

/** "Minhas tarefas" ou "Tarefas em andamento": lista com filtro de status, mais recentes primeiro. */
export function montarTarefas(
  raiz: HTMLElement,
  { api, escopo, comResponsavel, voltar, abrir }: DepsTarefas,
): { encerrar(): void } {
  let encerrado = false;
  let requisicao = 0;
  const filtros = filtrosDeTarefas(escopo);

  const filtro = criar('select', 'tarefas-filtro');
  filtro.setAttribute('aria-label', 'Filtrar por status');
  for (const { valor, rotulo } of filtros) filtro.append(new Option(rotulo, valor));
  const lista = criar('ul', 'artes-lista');
  const situacao = criar('div', 'artes-situacao');
  const topo = criar('div', 'artes-topo tarefas-topo');
  topo.append(botao('Voltar', voltar), filtro);
  const card = criar('div', 'card');
  card.append(criar('h2', undefined, ROTULOS_ESCOPO_TAREFAS[escopo]), topo, lista, situacao);
  raiz.append(card);

  function linha(tarefa: Tarefa): HTMLElement {
    const item = criar('li');
    const botaoLinha = criar('button', 'artes-item tarefa-item');
    botaoLinha.type = 'button';
    const texto = criar('span', 'tarefa-item-texto');
    const detalhes = [`Atualizada em ${formatarDataHora(tarefa.atualizadoEm)}`];
    if (comResponsavel) detalhes.unshift(tarefa.responsavel?.nome ?? 'Sem responsável');
    texto.append(
      criar('span', 'artes-item-nome', tituloTarefa(tarefa)),
      criar('span', 'artes-item-cnpj', detalhes.join(' · ')),
    );
    botaoLinha.append(texto, seloStatus(tarefa));
    botaoLinha.addEventListener('click', () => abrir(tarefa));
    item.append(botaoLinha);
    return item;
  }

  async function carregar() {
    const minha = ++requisicao;
    const consulta = filtros.find((f) => f.valor === filtro.value)?.consulta ?? { escopo };
    lista.replaceChildren();
    situacao.replaceChildren(criar('div', 'hint', 'Carregando…'));
    try {
      const tarefas = await api.listar(consulta);
      if (encerrado || minha !== requisicao) return;
      lista.replaceChildren(...tarefas.map(linha));
      situacao.replaceChildren(
        ...(tarefas.length ? [] : [criar('div', 'hint', 'Nenhuma tarefa encontrada.')]),
      );
    } catch (erro) {
      if (encerrado || minha !== requisicao) return;
      situacao.replaceChildren(blocoErro(mensagemErro(erro), () => void carregar()));
    }
  }

  filtro.addEventListener('change', () => void carregar());
  void carregar();

  return {
    encerrar() {
      encerrado = true;
      card.remove();
    },
  };
}
