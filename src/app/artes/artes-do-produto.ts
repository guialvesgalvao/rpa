import type { ArtesApi } from '../api.js';
import { type ArteDoProduto, type ProdutoDoCliente, rotuloArtes } from '../plataforma/contratos.js';
import { blocoErro, botao, criar, mensagemErro } from './dom.js';
import { formatarDataHora } from './tarefas-dados.js';

export type DepsArtesDoProduto = {
  api: Pick<ArtesApi, 'artesDoProduto' | 'imagemDaArte' | 'baixarPdf'>;
  clienteId: string;
};

/**
 * Um produto do perfil do cliente (mesmo comportamento do site): clicar abre a lista das artes dele, buscada
 * só na primeira abertura; cada arte com imagem tem "Visualizar imagem", que abre a imagem num `<dialog>`, e
 * arte só com PDF mostra "Sem imagem"; embaixo, "Baixar arquivo PDF" (janela de salvar) ou "Sem PDF".
 */
export function itemDoProduto(
  produto: ProdutoDoCliente,
  { api, clienteId }: DepsArtesDoProduto,
): HTMLLIElement {
  const item = criar('li', 'produto-com-artes');
  const cabecalho = criar('button', 'produto-cabecalho');
  cabecalho.type = 'button';
  cabecalho.setAttribute('aria-expanded', 'false');
  cabecalho.append(
    criar('span', undefined, produto.nome),
    criar('span', 'artes-contador', rotuloArtes(produto.quantidadeArtes)),
  );
  const corpo = criar('div', 'artes-do-produto');
  corpo.id = `artes-${produto.id}`;
  corpo.hidden = true;
  cabecalho.setAttribute('aria-controls', corpo.id);
  item.append(cabecalho, corpo);

  let carregou = false;
  // Cada abertura ganha um número; a resposta de uma carga antiga (fechou e reabriu) é descartada.
  let carga = 0;

  async function carregar() {
    const minha = ++carga;
    corpo.replaceChildren(criar('div', 'hint', 'Carregando…'));
    try {
      const artes = await api.artesDoProduto(clienteId, produto.id);
      if (minha !== carga) return;
      carregou = true;
      corpo.replaceChildren(listaDeArtes(produto, artes, api));
    } catch (erro) {
      if (minha !== carga) return;
      corpo.replaceChildren(blocoErro(mensagemErro(erro), () => void carregar()));
    }
  }

  cabecalho.addEventListener('click', () => {
    const abrir = corpo.hidden;
    corpo.hidden = !abrir;
    cabecalho.setAttribute('aria-expanded', String(abrir));
    if (abrir && !carregou) void carregar();
    // Fechar no meio da carga a descarta; reabrir busca de novo.
    if (!abrir && !carregou) carga++;
  });
  return item;
}

function listaDeArtes(
  produto: ProdutoDoCliente,
  artes: ArteDoProduto[],
  api: DepsArtesDoProduto['api'],
): HTMLElement {
  if (artes.length === 0) return criar('div', 'hint', 'Nenhuma arte cadastrada para este produto.');
  const lista = criar('ul');
  lista.setAttribute('aria-label', `Artes de ${produto.nome}`);
  for (const arte of artes) {
    const linha = criar('li');
    const texto = criar('div');
    const maquinas = arte.maquinas.length
      ? ` · ${arte.maquinas.map((maquina) => maquina.nome).join(', ')}`
      : '';
    texto.append(
      criar('strong', undefined, arte.nome),
      criar('div', 'hint', `${arte.cor.nome}${maquinas} · ${formatarDataHora(arte.criadoEm)}`),
    );
    const acoes = criar('div', 'acoes-arte');
    acoes.append(
      arte.temImagem
        ? botao('Visualizar imagem', () => abrirImagem(arte, api))
        : criar('span', 'hint', 'Sem imagem'),
    );
    if (arte.temPdf) {
      const aviso = criar('span', 'hint');
      acoes.append(
        botao('Baixar arquivo PDF', () => void baixarPdf(arte, api, aviso)),
        aviso,
      );
    } else {
      acoes.append(criar('span', 'hint', 'Sem PDF'));
    }
    linha.append(texto, acoes);
    lista.append(linha);
  }
  return lista;
}

/** Pede o destino e grava o PDF; o aviso ao lado do botão diz se salvou ou o erro. */
async function baixarPdf(
  arte: ArteDoProduto,
  api: DepsArtesDoProduto['api'],
  aviso: HTMLElement,
): Promise<void> {
  aviso.className = 'hint';
  aviso.textContent = 'Baixando…';
  try {
    const salvo = await api.baixarPdf({ arteId: arte.id, nome: arte.nome });
    aviso.textContent = salvo ? 'Salvo.' : '';
  } catch (erro) {
    aviso.className = 'hint warn';
    aviso.textContent = mensagemErro(erro);
  }
}

/**
 * Modal nativo com a imagem: os bytes vêm do main pelo IPC e viram um `blob:` (a CSP só libera `blob:` em
 * `img-src`), revogado ao fechar. Fecha pelo botão, pelo Esc e pelo clique fora da imagem.
 */
function abrirImagem(arte: ArteDoProduto, api: DepsArtesDoProduto['api']): void {
  const dialogo = criar('dialog', 'modal-imagem');
  dialogo.setAttribute('aria-label', `Imagem da arte ${arte.nome}`);
  const conteudo = criar('div', 'modal-imagem-conteudo');
  const topo = criar('div', 'modal-imagem-topo');
  topo.append(
    criar('strong', undefined, arte.nome),
    botao('Fechar', () => dialogo.close()),
  );
  const area = criar('div', 'hint', 'Carregando…');
  conteudo.append(topo, area);
  dialogo.append(conteudo);

  let url: string | undefined;
  let fechado = false;
  dialogo.addEventListener('close', () => {
    fechado = true;
    if (url) URL.revokeObjectURL(url);
    dialogo.remove();
  });
  // O clique no fundo (fora do conteúdo) chega com o próprio `<dialog>` como alvo.
  dialogo.addEventListener('click', (evento) => {
    if (evento.target === dialogo) dialogo.close();
  });
  document.body.append(dialogo);
  dialogo.showModal();

  api
    .imagemDaArte(arte.id)
    .then(({ mime, bytes }) => {
      if (fechado) return;
      url = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: mime }));
      const imagem = criar('img');
      imagem.alt = `Arte ${arte.nome}`;
      imagem.src = url;
      area.replaceWith(imagem);
    })
    .catch((erro: unknown) => {
      if (fechado) return;
      const aviso = criar('div', 'hint warn', mensagemErro(erro));
      aviso.setAttribute('role', 'alert');
      area.replaceWith(aviso);
    });
}
