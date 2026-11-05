import type { ArtesApi, TarefasApi } from '../api.js';
import {
  type EscopoTarefas,
  type Perfil,
  ROTULOS_ESCOPO_TAREFAS,
  submenusTarefas,
  type TarefaDetalhe,
  tituloTarefa,
} from '../plataforma/contratos.js';
import { montarCliente } from './cliente.js';
import { botao, criar } from './dom.js';
import { montarFormulario } from './formulario.js';
import { montarHistorico } from './historico-tarefa.js';
import { montarLista } from './lista.js';
import { montarTarefa } from './tarefa.js';
import { montarTarefas } from './tarefas.js';

type Visao = { encerrar(): void };

/**
 * Navegação da aba Artes: a home (submenus de tarefas do perfil + lista de clientes) → cliente → nova
 * arte ou tarefa; e submenu → tarefas → tarefa → histórico ou conclusão. A lista fica montada (com a
 * busca e o que já carregou) enquanto se vê o resto; `reiniciar` descarta tudo, para a troca de empresa
 * ou de usuário.
 */
export function criarArtes(
  raiz: HTMLElement,
  api: ArtesApi,
  tarefas: TarefasApi,
): { reiniciar(perfil: Perfil): void; encerrar(): void } {
  const areaLista = document.createElement('div');
  const areaDetalhe = document.createElement('div');
  raiz.append(areaLista, areaDetalhe);
  areaDetalhe.hidden = true;

  let lista: Visao | undefined;
  let submenu: HTMLElement | undefined;
  let detalhe: Visao | undefined;
  let perfilAtual: Perfil = 'arte_finalista';

  function mostrarLista() {
    detalhe?.encerrar();
    detalhe = undefined;
    areaDetalhe.hidden = true;
    areaLista.hidden = false;
  }

  function mostrarDetalhe(abrir: () => Visao) {
    detalhe?.encerrar();
    areaLista.hidden = true;
    areaDetalhe.hidden = false;
    detalhe = abrir();
  }

  function mostrarCliente(clienteId: string, sucesso?: string) {
    mostrarDetalhe(() =>
      montarCliente(areaDetalhe, {
        api,
        clienteId,
        sucesso,
        voltar: mostrarLista,
        cadastrar: (cliente, produtoId) =>
          mostrarDetalhe(() =>
            montarFormulario(areaDetalhe, {
              api,
              cliente,
              produtoId,
              voltar: () => mostrarCliente(clienteId),
              concluido: () => mostrarCliente(clienteId, 'Arte cadastrada'),
            }),
          ),
        iniciarTarefa: async (cliente, produtoId) => {
          const tarefa = await tarefas.criar(cliente.id, produtoId);
          mostrarTarefa(tarefa.id, () => mostrarCliente(clienteId), 'Tarefa criada');
        },
      }),
    );
  }

  function mostrarTarefas(escopo: EscopoTarefas) {
    mostrarDetalhe(() =>
      montarTarefas(areaDetalhe, {
        api: tarefas,
        escopo,
        comResponsavel: perfilAtual === 'admin',
        voltar: mostrarLista,
        abrir: (tarefa) => mostrarTarefa(tarefa.id, () => mostrarTarefas(escopo)),
      }),
    );
  }

  /** `voltar` é a tela de origem (lista de tarefas ou página do cliente). */
  function mostrarTarefa(tarefaId: string, voltar: () => void, sucesso?: string) {
    const deNovo = (mensagem?: string) => mostrarTarefa(tarefaId, voltar, mensagem);
    mostrarDetalhe(() =>
      montarTarefa(areaDetalhe, {
        api: tarefas,
        tarefaId,
        sucesso,
        voltar,
        concluir: (tarefa) => mostrarConclusao(tarefa, deNovo),
        historico: (tarefa) =>
          mostrarDetalhe(() =>
            montarHistorico(areaDetalhe, { api: tarefas, tarefa, voltar: () => deNovo() }),
          ),
      }),
    );
  }

  /** Formulário de nova arte no modo conclusão: cliente e produto da tarefa, envio pela tarefa. */
  function mostrarConclusao(tarefa: TarefaDetalhe, voltar: (mensagem?: string) => void) {
    mostrarDetalhe(() =>
      montarFormulario(areaDetalhe, {
        api,
        cliente: { id: tarefa.cliente.id, nomeExibicao: tarefa.cliente.nome },
        produtoId: tarefa.produto.id,
        produtoFixo: { nome: tarefa.produto.nome },
        titulo: `Concluir — ${tituloTarefa(tarefa)}`,
        enviar: async (entrada) => {
          const resultado = await tarefas.concluir({ ...entrada, tarefaId: tarefa.id });
          return resultado.ok ? { ok: true } : resultado;
        },
        voltar: () => voltar(),
        concluido: () => voltar('Tarefa concluída e arte cadastrada'),
      }),
    );
  }

  function montarSubmenu(perfil: Perfil): HTMLElement {
    const bloco = criar('div', 'artes-submenu');
    for (const escopo of submenusTarefas(perfil)) {
      bloco.append(botao(ROTULOS_ESCOPO_TAREFAS[escopo], () => mostrarTarefas(escopo)));
    }
    return bloco;
  }

  function encerrar() {
    lista?.encerrar();
    lista = undefined;
    submenu?.remove();
    submenu = undefined;
    mostrarLista();
  }

  return {
    encerrar,
    reiniciar(perfil) {
      encerrar();
      perfilAtual = perfil;
      submenu = montarSubmenu(perfil);
      areaLista.append(submenu);
      lista = montarLista(areaLista, {
        api,
        abrirCliente: (cliente) => mostrarCliente(cliente.id),
      });
    },
  };
}
