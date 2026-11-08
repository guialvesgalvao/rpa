import type { ArquivoEscolhido, TarefasApi } from '../api.js';
import {
  ANEXOS_POR_COMENTARIO,
  COMENTARIO_TAREFA_MAX,
  type ComentarioTarefa,
  precisaDaArteParaConcluir,
  ROTULOS_STATUS_TAREFA,
  STATUS_TAREFA,
  type StatusTarefa,
  type TarefaDetalhe,
  tituloTarefa,
} from '../plataforma/contratos.js';
import { blocoErro, botao, criar, mensagemErro } from './dom.js';
import { acaoDoStatus, formatarDataHora, formatarTamanho } from './tarefas-dados.js';
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

/** Comentário com autor, data, texto e os anexos, cada um com o botão de baixar. */
function blocoComentario(
  comentario: ComentarioTarefa,
  baixar: (anexo: ComentarioTarefa['anexos'][number], aviso: HTMLElement) => void,
): HTMLElement {
  const item = criar('li', 'tarefa-comentario');
  item.append(
    criar(
      'div',
      'hint',
      `${comentario.autor?.nome ?? 'Usuário removido'} · ${formatarDataHora(comentario.criadoEm)}`,
    ),
  );
  if (comentario.texto) item.append(criar('div', 'tarefa-comentario-texto', comentario.texto));
  if (comentario.anexos.length) {
    const lista = criar('ul', 'tarefa-anexos');
    for (const anexo of comentario.anexos) {
      const linha = criar('li');
      const aviso = criar('span', 'hint');
      linha.append(
        criar('span', undefined, `${anexo.nome} (${formatarTamanho(anexo.tamanho)}) `),
        botao('Baixar', () => baixar(anexo, aviso)),
        aviso,
      );
      lista.append(linha);
    }
    item.append(lista);
  }
  return item;
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

    const baixar = async (anexo: ComentarioTarefa['anexos'][number], aviso: HTMLElement) => {
      aviso.className = 'hint';
      aviso.textContent = ' Baixando…';
      const comentario = tarefa.comentarios.find((c) => c.anexos.some((a) => a.id === anexo.id));
      try {
        const salvo = await api.baixarAnexo({
          tarefaId: tarefa.id,
          comentarioId: comentario?.id ?? '',
          anexoId: anexo.id,
          nome: anexo.nome,
        });
        aviso.textContent = salvo ? ' Salvo.' : '';
      } catch (erro) {
        aviso.className = 'hint warn';
        aviso.textContent = ` ${mensagemErro(erro)}`;
      }
    };
    const desenhar = (comentario: ComentarioTarefa) =>
      blocoComentario(comentario, (anexo, aviso) => void baixar(anexo, aviso));
    const comentarios = criar('ul', 'tarefa-comentarios');
    comentarios.append(...tarefa.comentarios.map(desenhar));
    const semComentarios = criar('div', 'hint', 'Nenhum comentário ainda.');
    semComentarios.hidden = tarefa.comentarios.length > 0;
    const texto = criar('textarea');
    texto.rows = 3;
    texto.maxLength = COMENTARIO_TAREFA_MAX;
    texto.placeholder = 'Escreva um comentário';
    texto.setAttribute('aria-label', 'Novo comentário');
    const erroComentario = criar('div', 'hint warn');
    erroComentario.setAttribute('role', 'alert');
    // Anexos escolhidos para o próximo comentário (ids do diálogo do main).
    let anexos: ArquivoEscolhido[] = [];
    const listaAnexos = criar('ul', 'tarefa-anexos');
    const desenharAnexos = () => {
      listaAnexos.replaceChildren(
        ...anexos.map((anexo) => {
          const linha = criar('li');
          linha.append(
            criar('span', undefined, `${anexo.nome} (${formatarTamanho(anexo.tamanho)}) `),
            botao('Remover', () => {
              anexos = anexos.filter((a) => a.id !== anexo.id);
              desenharAnexos();
            }),
          );
          return linha;
        }),
      );
    };
    const anexar = botao('Anexar', async () => {
      erroComentario.textContent = '';
      try {
        const escolhidos = await api.escolherAnexos();
        anexos = [...anexos, ...escolhidos].slice(0, ANEXOS_POR_COMENTARIO);
        if (anexos.length < escolhidos.length) {
          erroComentario.textContent = `Anexe no máximo ${ANEXOS_POR_COMENTARIO} arquivos por comentário.`;
        }
        desenharAnexos();
      } catch (erro) {
        erroComentario.textContent = mensagemErro(erro);
      }
    });
    const comentar = botao('Comentar', async () => {
      if (!texto.value.trim() && anexos.length === 0) {
        erroComentario.textContent = 'Escreva o comentário ou anexe um arquivo.';
        return;
      }
      comentar.disabled = true;
      anexar.disabled = true;
      erroComentario.textContent = '';
      try {
        const novo = await api.comentar(
          tarefa.id,
          texto.value,
          anexos.map((a) => a.id),
        );
        if (encerrado) return;
        tarefa.comentarios.push(novo);
        comentarios.append(desenhar(novo));
        semComentarios.hidden = true;
        texto.value = '';
        anexos = [];
        desenharAnexos();
      } catch (erro) {
        erroComentario.textContent = mensagemErro(erro);
      } finally {
        comentar.disabled = false;
        anexar.disabled = false;
      }
    });
    const acoesComentario = criar('div', 'actions');
    acoesComentario.append(comentar, anexar);
    const blocoComentarios = criar('div', 'artes-campo tarefa-bloco-comentarios');
    blocoComentarios.append(
      criar('label', undefined, 'Comentários'),
      comentarios,
      semComentarios,
      texto,
      listaAnexos,
      erroComentario,
      acoesComentario,
    );

    const topo = criar('div', 'artes-topo');
    topo.append(botao('Voltar', voltar));
    card.replaceChildren(
      topo,
      criar('h2', undefined, tituloTarefa(tarefa)),
      ...(mensagem ? [criar('div', 'artes-sucesso', mensagem)] : []),
      info,
      erroGeral,
      acoes,
      blocoComentarios,
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
