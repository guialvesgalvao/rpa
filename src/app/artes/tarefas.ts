import type { TarefasApi } from '../api.js';
import {
  ROTULOS_STATUS_TAREFA,
  type StatusTarefa,
  type Tarefa,
  tituloTarefa,
} from '../plataforma/contratos.js';
import { blocoErro, botao, criar, mensagemErro } from './dom.js';
import { filtrosDeTarefas, formatarDataHora } from './tarefas-dados.js';

export type DepsTarefas = {
  api: Pick<TarefasApi, 'listar'>;
  /** Status inicial do filtro (o do atalho); sem status, todas. */
  status?: StatusTarefa;
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

/**
 * Lista aberta por um atalho da home: filtro de status, mais recentes primeiro. O arte finalista só vê as
 * próprias (a API decide); o admin, todas da empresa.
 */
export function montarTarefas(
  raiz: HTMLElement,
  { api, status, comResponsavel, voltar, abrir }: DepsTarefas,
): { encerrar(): void } {
  let encerrado = false;
  let requisicao = 0;
  const filtros = filtrosDeTarefas('todas');

  const filtro = criar('select', 'tarefas-filtro');
  filtro.setAttribute('aria-label', 'Filtrar por status');
  for (const { valor, rotulo } of filtros) filtro.append(new Option(rotulo, valor));
  filtro.value = status ?? '';
  const lista = criar('ul', 'artes-lista');
  const situacao = criar('div', 'artes-situacao');
  const topo = criar('div', 'artes-topo tarefas-topo');
  topo.append(botao('Voltar', voltar), filtro);
  const card = criar('div', 'card');
  card.append(criar('h2', undefined, 'Tarefas de arte'), topo, lista, situacao);
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
    const consulta = filtros.find((f) => f.valor === filtro.value)?.consulta ?? { escopo: 'todas' };
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
