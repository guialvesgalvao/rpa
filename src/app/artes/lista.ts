import type { ArtesApi } from '../api.js';
import {
  type AcaoLista,
  type Cliente,
  type EstadoLista,
  estadoInicial,
  redutorLista,
} from '../plataforma/contratos.js';
import { blocoErro, criar, formatarCnpj, mensagemErro } from './dom.js';

const ESPERA_BUSCA_MS = 300;

export type DepsLista = {
  api: Pick<ArtesApi, 'listarClientes'>;
  abrirCliente: (cliente: Cliente) => void;
};

/**
 * Lista de clientes com busca (espera de 300 ms) e scroll infinito. O estado é o redutor de `contratos`,
 * o mesmo do site; respostas de buscas antigas são descartadas pelo número da requisição.
 */
export function montarLista(
  raiz: HTMLElement,
  { api, abrirCliente }: DepsLista,
): { encerrar(): void } {
  let estado: EstadoLista<Cliente> = estadoInicial<Cliente>();
  let requisicaoEnviada = -1;
  let erro = '';
  let encerrado = false;
  let espera: ReturnType<typeof setTimeout> | undefined;

  const campoBusca = criar('input');
  campoBusca.type = 'text';
  campoBusca.placeholder = 'Buscar por nome ou CNPJ';
  campoBusca.setAttribute('aria-label', 'Buscar cliente');
  const lista = criar('ul', 'artes-lista');
  const situacao = criar('div', 'artes-situacao');
  const sentinela = criar('div', 'artes-sentinela');
  const card = criar('div', 'card');
  card.append(criar('h2', undefined, 'Artes'), campoBusca, lista, situacao, sentinela);
  raiz.append(card);

  const observador = new IntersectionObserver((entradas) => {
    if (entradas.some((entrada) => entrada.isIntersecting)) despachar({ tipo: 'carregar_mais' });
  });
  observador.observe(sentinela);

  function linha(cliente: Cliente): HTMLElement {
    const item = criar('li');
    const abrir = criar('button', 'artes-item');
    abrir.type = 'button';
    abrir.append(
      criar('span', 'artes-item-nome', cliente.nomeExibicao),
      criar('span', 'artes-item-cnpj', formatarCnpj(cliente.cnpj)),
    );
    abrir.addEventListener('click', () => abrirCliente(cliente));
    item.append(abrir);
    return item;
  }

  function desenhar() {
    lista.replaceChildren(...estado.itens.map(linha));
    situacao.replaceChildren();
    if (estado.status === 'carregando') {
      situacao.append(criar('div', 'hint', 'Carregando…'));
    } else if (estado.status === 'erro') {
      situacao.append(blocoErro(erro, () => despachar({ tipo: 'tentar_de_novo' })));
    } else if (estado.itens.length === 0) {
      situacao.append(
        criar(
          'div',
          'hint',
          estado.busca
            ? `Nenhum cliente encontrado para '${estado.busca}'`
            : 'Nenhum cliente cadastrado.',
        ),
      );
    }
    // Com a página curta o sentinela continua visível e o observador não dispara de novo: reobserva.
    if (estado.status === 'ocioso' && !estado.fim) {
      observador.unobserve(sentinela);
      observador.observe(sentinela);
    }
  }

  async function buscar() {
    const requisicao = estado.requisicao;
    requisicaoEnviada = requisicao;
    try {
      const pagina = await api.listarClientes(estado.busca, estado.proximoCursor);
      despachar({
        tipo: 'pagina_carregada',
        requisicao,
        itens: pagina.itens,
        proximoCursor: pagina.proximoCursor,
      });
    } catch (e) {
      erro = mensagemErro(e);
      despachar({ tipo: 'falhou', requisicao });
    }
  }

  function despachar(acao: AcaoLista<Cliente>) {
    if (encerrado) return;
    estado = redutorLista(estado, acao);
    desenhar();
    if (estado.status === 'carregando' && requisicaoEnviada !== estado.requisicao) void buscar();
  }

  campoBusca.addEventListener('input', () => {
    clearTimeout(espera);
    espera = setTimeout(
      () => despachar({ tipo: 'busca_alterada', busca: campoBusca.value.trim() }),
      ESPERA_BUSCA_MS,
    );
  });

  desenhar();
  void buscar();

  return {
    encerrar() {
      encerrado = true;
      clearTimeout(espera);
      observador.disconnect();
      card.remove();
    },
  };
}
