import type { TarefasApi } from '../api.js';
import {
  precisaDaArteParaConcluir,
  ROTULOS_STATUS_TAREFA,
  STATUS_TAREFA,
  type StatusTarefa,
  type TarefaDetalhe,
  tituloTarefa,
} from '../plataforma/contratos.js';
import { blocoComentarios } from './comentarios.js';
import { blocoErro, botao, criar, mensagemErro } from './dom.js';
import { acaoDoStatus, formatarDataHora } from './tarefas-dados.js';
import { seloStatus } from './tarefas.js';

export type DepsTarefa = {
  api: Pick<TarefasApi, 'obter' | 'mudarStatus' | 'comentar' | 'escolherAnexos' | 'baixarAnexo'>;
  tarefaId: string;
  /** Mensagem de sucesso no topo (ex.: "Tarefa criada"). */
  sucesso?: string;
  voltar: () => void;
  /** Abre o formulário da arte, que conclui a tarefa. */
  concluir: (tarefa: TarefaDetalhe) => void;
  historico: (tarefa: TarefaDetalhe) => void;
};

function campoInfo(rotulo: string, valor: string | HTMLElement): HTMLElement {
  const linha = criar('div', 'tarefa-info-linha');
  const conteudo = typeof valor === 'string' ? criar('span', undefined, valor) : valor;
  linha.append(criar('span', 'tarefa-info-rotulo', rotulo), conteudo);
  return linha;
}

/**
 * Detalhe da tarefa: dados, status (qualquer um; Concluída sem arte abre o formulário da arte),
 * comentários e o link para o histórico.
 */
export function montarTarefa(
  raiz: HTMLElement,
  { api, tarefaId, sucesso, voltar, concluir, historico }: DepsTarefa,
): { encerrar(): void } {
  let encerrado = false;
  const card = criar('div', 'card');
  raiz.append(card);

  async function carregar(mensagem = sucesso) {
    card.replaceChildren(criar('div', 'hint', 'Carregando…'));
    try {
      const tarefa = await api.obter(tarefaId);
      if (encerrado) return;
      desenhar(tarefa, mensagem);
    } catch (erro) {
      if (encerrado) return;
      card.replaceChildren(
        botao('Voltar', voltar),
        blocoErro(mensagemErro(erro), () => void carregar()),
      );
    }
  }

  function desenhar(tarefa: TarefaDetalhe, mensagem?: string) {
    const erroGeral = criar('div', 'hint warn');
    erroGeral.setAttribute('role', 'alert');

    const status = criar('select');
    status.setAttribute('aria-label', 'Status da tarefa');
    for (const s of STATUS_TAREFA) status.append(new Option(ROTULOS_STATUS_TAREFA[s], s));
    status.value = tarefa.status;
    status.addEventListener('change', async () => {
      const escolhido = status.value as StatusTarefa;
      const acao = acaoDoStatus(escolhido, tarefa);
      if (acao === 'nada') return;
      if (acao === 'pedir_arte') {
        status.value = tarefa.status;
        concluir(tarefa);
        return;
      }
      status.disabled = true;
      erroGeral.textContent = '';
      try {
        await api.mudarStatus(tarefa.id, escolhido);
        if (!encerrado) await carregar('Status atualizado');
      } catch (erro) {
        status.value = tarefa.status;
        status.disabled = false;
        erroGeral.textContent = mensagemErro(erro);
      }
    });

    const info = criar('div', 'tarefa-info');
    info.append(
      campoInfo('Cliente', tarefa.cliente.nome),
      campoInfo('Produto', tarefa.produto.nome),
      campoInfo('Responsável', tarefa.responsavel?.nome ?? 'Usuário removido'),
      campoInfo('Criada em', formatarDataHora(tarefa.criadoEm)),
      campoInfo('Atualizada em', formatarDataHora(tarefa.atualizadoEm)),
      campoInfo('Status', seloStatus(tarefa)),
      campoInfo('Mudar status', status),
      campoInfo(
        'Arte',
        tarefa.arteId ? 'Cadastrada na conclusão' : 'Ainda não cadastrada (exigida para concluir)',
      ),
    );

    const acoes = criar('div', 'actions');
    if (precisaDaArteParaConcluir(tarefa)) {
      acoes.append(botao('Concluir com a arte', () => concluir(tarefa), 'primary'));
    }
    acoes.append(botao('Histórico', () => historico(tarefa)));

    const comentarios = blocoComentarios({
      comentarios: tarefa.comentarios,
      comentar: (texto, anexoIds) => api.comentar(tarefa.id, texto, anexoIds),
      escolherAnexos: () => api.escolherAnexos(),
      baixar: (comentarioId, anexo) =>
        api.baixarAnexo({ tarefaId: tarefa.id, comentarioId, anexoId: anexo.id, nome: anexo.nome }),
      encerrado: () => encerrado,
    });

    const topo = criar('div', 'artes-topo');
    topo.append(botao('Voltar', voltar));
    card.replaceChildren(
      topo,
      criar('h2', undefined, tituloTarefa(tarefa)),
      ...(mensagem ? [criar('div', 'artes-sucesso', mensagem)] : []),
      info,
      erroGeral,
      acoes,
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
