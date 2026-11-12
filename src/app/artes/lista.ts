import type { ArtesApi } from '../api.js';
import { montarPaginacao } from '../paginacao.js';
import {
  type AcaoPaginas,
  type Cliente,
  type EstadoPaginas,
  estadoInicialPaginas,
  itensDaPagina,
  LIMITE_PADRAO_CLIENTES,
  redutorPaginas,
  totalDePaginas,
} from '../plataforma/contratos.js';
import { blocoErro, criar, formatarCnpj, mensagemErro } from './dom.js';

const ESPERA_BUSCA_MS = 300;

export type DepsLista = {
  api: Pick<ArtesApi, 'listarClientes'>;
  abrirCliente: (cliente: Cliente) => void;
};

/**
 * Lista de clientes com busca (espera de 300 ms) e páginas numeradas de 20, uma requisição por página. O
 * estado é o redutor de `contratos`, o mesmo do site: páginas já vistas ficam em cache, busca nova volta à
 * página 1 e respostas de cargas antigas são descartadas pelo número da requisição.
 */
export function montarLista(
  raiz: HTMLElement,
  { api, abrirCliente }: DepsLista,
): { encerrar(): void } {
  let estado: EstadoPaginas<Cliente> = estadoInicialPaginas<Cliente>(LIMITE_PADRAO_CLIENTES);
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
  const controles = criar('div');
  const card = criar('div', 'card');
  card.append(criar('h2', undefined, 'Artes'), campoBusca, lista, situacao, controles);
  raiz.append(card);
  let paginaDesenhada = estado.pagina;

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
    const itens = itensDaPagina(estado);
    lista.replaceChildren(...itens.map(linha));
    situacao.replaceChildren();
    if (estado.status === 'carregando') {
      situacao.append(criar('div', 'hint', 'Carregando…'));
    } else if (estado.status === 'erro') {
      situacao.append(blocoErro(erro, () => despachar({ tipo: 'tentar_de_novo' })));
    } else if (itens.length === 0) {
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
    const paginacao =
      estado.total === null
        ? null
        : montarPaginacao({
            paginaAtual: estado.pagina,
            totalPaginas: totalDePaginas(estado.total, estado.porPagina),
            total: estado.total,
            rotulo: 'clientes',
            aoEscolher: (pagina) => despachar({ tipo: 'pagina_escolhida', pagina }),
          });
    controles.replaceChildren(...(paginacao ? [paginacao] : []));
    // Ao trocar de página, traz o começo da lista de volta para a tela se ele tiver saído dela.
    if (paginaDesenhada !== estado.pagina) {
      paginaDesenhada = estado.pagina;
      if (card.getBoundingClientRect().top < 0) card.scrollIntoView({ block: 'start' });
    }
  }

  async function buscar() {
    const requisicao = estado.requisicao;
    requisicaoEnviada = requisicao;
    try {
      const resultado = await api.listarClientes(estado.busca, estado.pagina);
      despachar({
        tipo: 'pagina_carregada',
        requisicao,
        itens: resultado.itens,
        total: resultado.total ?? resultado.itens.length,
      });
    } catch (e) {
      erro = mensagemErro(e);
      despachar({ tipo: 'falhou', requisicao });
    }
  }

  function despachar(acao: AcaoPaginas<Cliente>) {
    if (encerrado) return;
    estado = redutorPaginas(estado, acao);
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
      card.remove();
    },
  };
}
