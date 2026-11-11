import type { ArquivoEscolhido } from '../api.js';
import {
  ANEXOS_POR_COMENTARIO,
  COMENTARIO_TAREFA_MAX,
  type ComentarioTarefa,
} from '../plataforma/contratos.js';
import { botao, criar, mensagemErro } from './dom.js';
import { formatarDataHora, formatarTamanho } from './tarefas-dados.js';

type Anexo = ComentarioTarefa['anexos'][number];

export type DepsComentarios = {
  /** Os comentários já carregados; o novo entra no fim da lista. */
  comentarios: ComentarioTarefa[];
  /** Texto e ids dos anexos escolhidos no diálogo do main. */
  comentar: (texto: string, anexoIds: string[]) => Promise<ComentarioTarefa>;
  escolherAnexos: () => Promise<ArquivoEscolhido[]>;
  /** Pede o destino e grava; `false` se o usuário cancelou. */
  baixar: (comentarioId: string, anexo: Anexo) => Promise<boolean>;
  /** A tela foi fechada durante o envio: não mexe mais no DOM. */
  encerrado: () => boolean;
};

/** Comentário com autor, data, texto e os anexos, cada um com o botão de baixar. */
function blocoComentario(
  comentario: ComentarioTarefa,
  baixar: (anexo: Anexo, aviso: HTMLElement) => void,
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
 * Bloco "Comentários" das tarefas de arte e dos pedidos de compra: a lista (com o download dos anexos) e o
 * formulário de texto com até 5 anexos (mesmos limites nos dois módulos).
 */
export function blocoComentarios({
  comentarios: iniciais,
  comentar: enviar,
  escolherAnexos,
  baixar: baixarAnexo,
  encerrado,
}: DepsComentarios): HTMLElement {
  const lidos = [...iniciais];
  const baixar = async (anexo: Anexo, aviso: HTMLElement) => {
    aviso.className = 'hint';
    aviso.textContent = ' Baixando…';
    const comentario = lidos.find((c) => c.anexos.some((a) => a.id === anexo.id));
    try {
      const salvo = await baixarAnexo(comentario?.id ?? '', anexo);
      aviso.textContent = salvo ? ' Salvo.' : '';
    } catch (erro) {
      aviso.className = 'hint warn';
      aviso.textContent = ` ${mensagemErro(erro)}`;
    }
  };
  const desenhar = (comentario: ComentarioTarefa) =>
    blocoComentario(comentario, (anexo, aviso) => void baixar(anexo, aviso));
  const lista = criar('ul', 'tarefa-comentarios');
  lista.append(...lidos.map(desenhar));
  const semComentarios = criar('div', 'hint', 'Nenhum comentário ainda.');
  semComentarios.hidden = lidos.length > 0;
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
      const escolhidos = await escolherAnexos();
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
      const novo = await enviar(
        texto.value,
        anexos.map((a) => a.id),
      );
      if (encerrado()) return;
      lidos.push(novo);
      lista.append(desenhar(novo));
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
  const acoes = criar('div', 'actions');
  acoes.append(comentar, anexar);
  const bloco = criar('div', 'artes-campo tarefa-bloco-comentarios');
  bloco.append(
    criar('label', undefined, 'Comentários'),
    lista,
    semComentarios,
    texto,
    listaAnexos,
    erroComentario,
    acoes,
  );
  return bloco;
}
