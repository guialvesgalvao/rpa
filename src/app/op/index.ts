import { MAX_INTERVALO, montarSelecao } from '../../processes/bling/selecao.js';
import type { ArtesApi, ItemOpTela, OpApi, PedidoOpTela, ResultadoOp } from '../api.js';
import { mensagemErro } from '../artes/dom.js';
import { montarFormulario } from '../artes/formulario.js';
import { preencherResultado } from '../resultados.js';
import { renderPedidos } from './dom.js';
import { AVISO_OBSERVACAO_CORTADA, montarPreenchimento } from './preenchimento.js';
import {
  aplicarArtesRecarregadas,
  type ArtesRecarregadas,
  chaveItem,
  type EscolhaItem,
  itensParaGerar,
  type LinhaConfirmacao,
  linhasConfirmacao,
  montarEscolhas,
  resumirSelecao,
} from './lista.js';

export type DepsOp = {
  api: OpApi;
  artes: Pick<ArtesApi, 'opcoes' | 'criarCor' | 'escolherArquivo' | 'cadastrar'>;
  escolherPasta(atual: string): Promise<string | null>;
  abrirPasta(dir: string): Promise<void>;
};

export type TelaOp = {
  /** Descarta pedidos, escolhas e resultados (troca de empresa ou de usuário). */
  reiniciar(): void;
  encerrar(): void;
  /** Pasta padrão das Configurações; o campo a acompanha enquanto o usuário não a alterar. */
  definirPasta(dir: string): void;
};

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

/**
 * Aba OP: informa os pedidos (como na Fatura), busca pedidos, clientes e artes, deixa escolher os
 * produtos e as artes e gera um PDF por produto. O formulário de nova arte abre no lugar da lista.
 */
export function criarOp({ api, artes, escolherPasta, abrirPasta }: DepsOp): TelaOp {
  const principal = $('op-principal');
  const detalhe = $('op-detalhe');
  const numeros = $<HTMLTextAreaElement>('op-numeros');
  const de = $<HTMLInputElement>('op-de');
  const ate = $<HTMLInputElement>('op-ate');
  const confirmar = $<HTMLButtonElement>('op-confirmar');
  const contagem = $('op-contagem');
  const selecaoCard = $('op-selecao');
  const aviso = $('op-aviso');
  const lista = $('op-pedidos');
  const resumoSelecao = $('op-resumo-selecao');
  const pasta = $<HTMLInputElement>('op-pasta');
  const escolher = $<HTMLButtonElement>('op-escolher');
  const gerar = $<HTMLButtonElement>('op-gerar');
  const abrir = $<HTMLButtonElement>('op-abrir');
  const resumo = $('op-resumo');
  const erroGeral = $('op-erro-geral');
  const resultado = $('op-resultado');
  const linhasResultado = $('op-itens');
  const dialogConfirmacao = $<HTMLDialogElement>('op-confirmacao');
  const listaConfirmacao = $('op-confirmacao-lista');

  let pedidos: PedidoOpTela[] = [];
  let escolhas = new Map<string, EscolhaItem>();
  let desatualizada = false;
  let ocupado = false;
  let pastaPadrao = '';
  /** Muda a cada `reiniciar`: respostas de uma busca anterior são descartadas. */
  let geracao = 0;
  let formulario: { encerrar(): void } | undefined;
  const linhas = new Map<string, HTMLTableRowElement>();

  function atualizarContagem() {
    const sel = montarSelecao(numeros.value, de.value, ate.value);
    const partes: string[] = [];
    if (sel.numeros.length) partes.push(`${sel.numeros.length} pedido(s)`);
    if (sel.invalidos.length)
      partes.push(`Ignorados (não são números): ${sel.invalidos.join(', ')}`);
    if (sel.erroIntervalo) partes.push(`Intervalo: ${sel.erroIntervalo}`);
    contagem.textContent = partes.join(' · ');
    contagem.classList.toggle('warn', sel.invalidos.length > 0 || sel.erroIntervalo !== undefined);
  }

  function atualizarControles() {
    for (const el of [numeros, de, ate, pasta, escolher, confirmar]) el.disabled = ocupado;
    aviso.hidden = !desatualizada;
    selecaoCard.classList.toggle('desatualizada', desatualizada);
    resumoSelecao.textContent = resumirSelecao(pedidos, escolhas);
    gerar.disabled =
      ocupado ||
      desatualizada ||
      itensParaGerar(pedidos, escolhas).length === 0 ||
      !pasta.value.trim();
  }

  function desenharLista() {
    renderPedidos(lista, {
      pedidos,
      escolhas,
      bloqueado: ocupado,
      aoMudar: atualizarControles,
      novaArte: abrirCadastro,
      preencher: abrirPreenchimento,
    });
  }

  function definirOcupado(valor: boolean) {
    ocupado = valor;
    desenharLista();
    atualizarControles();
  }

  async function buscar() {
    const sel = montarSelecao(numeros.value, de.value, ate.value);
    const problema = sel.erroIntervalo
      ? `Intervalo: ${sel.erroIntervalo}`
      : sel.numeros.length === 0
        ? 'Informe ao menos um número de pedido.'
        : sel.numeros.length > MAX_INTERVALO
          ? `Informe no máximo ${MAX_INTERVALO} pedidos por vez.`
          : undefined;
    if (problema) {
      contagem.textContent = problema;
      contagem.classList.add('warn');
      return;
    }
    const minha = geracao;
    erroGeral.textContent = '';
    resumo.textContent = 'Buscando os pedidos…';
    definirOcupado(true);
    try {
      const encontrados = await api.buscarPedidos(sel.numeros);
      if (minha !== geracao) return;
      escolhas = montarEscolhas(encontrados, escolhas);
      pedidos = encontrados;
      desatualizada = false;
      selecaoCard.hidden = false;
      resumo.textContent = '';
    } catch (erro) {
      if (minha !== geracao) return;
      resumo.textContent = '';
      erroGeral.textContent = mensagemErro(erro);
    } finally {
      if (minha === geracao) definirOcupado(false);
    }
  }

  function mostrarPrincipal() {
    formulario?.encerrar();
    formulario = undefined;
    detalhe.hidden = true;
    principal.hidden = false;
  }

  /** Cadastra a arte e volta à lista com a arte nova (a mais nova) escolhida neste produto. */
  function abrirCadastro(pedido: Extract<PedidoOpTela, { situacao: 'ok' }>, item: ItemOpTela) {
    const cliente = pedido.cliente;
    if (!cliente) return;
    principal.hidden = true;
    detalhe.hidden = false;
    formulario?.encerrar();
    const minha = geracao;
    formulario = montarFormulario(detalhe, {
      api: artes,
      cliente,
      produtoId: item.produtoId ?? undefined,
      voltar: mostrarPrincipal,
      concluido: () => {
        mostrarPrincipal();
        void recarregarArtes(
          cliente.id,
          item.codigo,
          { numero: pedido.numero, indice: item.indice },
          minha,
        );
      },
    });
  }

  /** Dados da OP (entrega, processo, observação) guardados na escolha do produto até gerar. */
  function abrirPreenchimento(pedido: Extract<PedidoOpTela, { situacao: 'ok' }>, item: ItemOpTela) {
    const escolha = escolhas.get(chaveItem(pedido.numero, item.indice));
    if (!escolha) return;
    principal.hidden = true;
    detalhe.hidden = false;
    formulario?.encerrar();
    formulario = montarPreenchimento(detalhe, {
      titulo: `Pedido ${pedido.numero} · ${item.codigo} — ${item.descricao}`,
      inicial: escolha.preenchimento,
      ...(pedido.observacaoCortada &&
        escolha.preenchimento?.observacao === pedido.observacao && {
          aviso: AVISO_OBSERVACAO_CORTADA,
        }),
      voltar: mostrarPrincipal,
      salvar: (preenchimento) => {
        if (preenchimento) escolha.preenchimento = preenchimento;
        else delete escolha.preenchimento;
        mostrarPrincipal();
        desenharLista();
        atualizarControles();
      },
    });
  }

  /** A arte nova fica escolhida só no item de origem; os demais só a ganham como opção. */
  async function recarregarArtes(
    clienteId: string,
    codigo: string,
    origem: ArtesRecarregadas['origem'],
    minha: number,
  ) {
    try {
      const { produtoId, artes: novas } = await api.artesDoItem(clienteId, codigo);
      if (minha !== geracao) return;
      ({ pedidos, escolhas } = aplicarArtesRecarregadas(pedidos, escolhas, {
        clienteId,
        codigo,
        produtoId,
        artes: novas,
        origem,
      }));
      desenharLista();
      atualizarControles();
    } catch (erro) {
      if (minha === geracao) erroGeral.textContent = mensagemErro(erro);
    }
  }

  function renderResultado(item: ResultadoOp) {
    const tr = linhas.get(chaveItem(item.numero, item.indice));
    if (!tr) return;
    const [, , status, celula] = tr.cells;
    const comNumero = item.numeroOp && item.status !== 'ok' ? `OP nº ${item.numeroOp}` : undefined;
    preencherResultado(status!, celula!, { ...item, detalhe: item.detalhe ?? comNumero });
  }

  function montarResultados(itens: ReturnType<typeof itensParaGerar>) {
    linhasResultado.replaceChildren();
    linhas.clear();
    let anterior = '';
    for (const { numero, indice } of itens) {
      const pedido = pedidos.find((p) => p.numero === numero);
      const item = pedido?.situacao === 'ok' ? pedido.itens[indice] : undefined;
      const tr = document.createElement('tr');
      for (let i = 0; i < 4; i++) tr.appendChild(document.createElement('td'));
      if (numero !== anterior) {
        tr.className = 'grupo';
        tr.cells[0]!.textContent = numero;
        anterior = numero;
      }
      tr.cells[1]!.textContent = item ? `${item.codigo} — ${item.descricao}` : '';
      linhasResultado.appendChild(tr);
      linhas.set(chaveItem(numero, indice), tr);
      renderResultado({
        numero,
        indice,
        codigo: item?.codigo ?? '',
        descricao: item?.descricao ?? '',
        status: 'pendente',
      });
    }
    resultado.hidden = itens.length === 0;
  }

  /** Lista "Produto → Arte" agrupada por pedido; resolve `true` só no botão "Gerar OPs". */
  function confirmarGeracao(confirmacao: readonly LinhaConfirmacao[]): Promise<boolean> {
    listaConfirmacao.replaceChildren();
    let ul: HTMLUListElement | undefined;
    let anterior: string | undefined;
    for (const linha of confirmacao) {
      if (linha.pedido !== anterior || !ul) {
        const titulo = document.createElement('h3');
        titulo.textContent = `Pedido ${linha.pedido}`;
        ul = document.createElement('ul');
        listaConfirmacao.append(titulo, ul);
        anterior = linha.pedido;
      }
      const li = document.createElement('li');
      li.textContent = `${linha.produto} → `;
      const arte = document.createElement('span');
      arte.textContent = linha.arte ?? 'sem arte';
      if (linha.arte === null) arte.className = 'sem-arte';
      li.appendChild(arte);
      ul.appendChild(li);
    }
    dialogConfirmacao.returnValue = '';
    return new Promise((resolve) => {
      dialogConfirmacao.addEventListener(
        'close',
        () => resolve(dialogConfirmacao.returnValue === 'gerar'),
        { once: true },
      );
      dialogConfirmacao.showModal();
    });
  }

  async function gerarOps() {
    const itens = itensParaGerar(pedidos, escolhas);
    if (!itens.length) return;
    const minha = geracao;
    const confirmado = await confirmarGeracao(linhasConfirmacao(pedidos, escolhas));
    if (!confirmado || minha !== geracao) return;
    erroGeral.textContent = '';
    resumo.textContent = 'Gerando as OPs…';
    montarResultados(itens);
    definirOcupado(true);
    try {
      const { resultados } = await api.gerar(itens, pasta.value);
      if (minha !== geracao) return;
      resultados.forEach(renderResultado);
      const ok = resultados.filter((r) => r.status === 'ok').length;
      resumo.textContent = `${ok} de ${resultados.length} OP(s) gerada(s).`;
    } catch (erro) {
      if (minha !== geracao) return;
      resumo.textContent = '';
      erroGeral.textContent = mensagemErro(erro);
    } finally {
      if (minha === geracao) definirOcupado(false);
    }
  }

  function onEntradaAlterada() {
    atualizarContagem();
    if (!selecaoCard.hidden) desatualizada = true;
    atualizarControles();
  }

  api.onProgresso((item) => renderResultado(item));
  for (const el of [numeros, de, ate]) el.addEventListener('input', onEntradaAlterada);
  for (const el of [de, ate]) {
    el.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !confirmar.disabled) void buscar();
    });
  }
  confirmar.addEventListener('click', () => void buscar());
  pasta.addEventListener('input', atualizarControles);
  escolher.addEventListener('click', async () => {
    const escolhida = await escolherPasta(pasta.value);
    if (escolhida) pasta.value = escolhida;
    atualizarControles();
  });
  abrir.addEventListener('click', async () => {
    erroGeral.textContent = '';
    try {
      await abrirPasta(pasta.value);
    } catch (erro) {
      erroGeral.textContent = `Não foi possível abrir a pasta: ${mensagemErro(erro)}`;
    }
  });
  gerar.addEventListener('click', () => void gerarOps());

  function limpar() {
    geracao++;
    if (dialogConfirmacao.open) dialogConfirmacao.close();
    mostrarPrincipal();
    for (const el of [numeros, de, ate, pasta]) el.value = '';
    pastaPadrao = '';
    pedidos = [];
    escolhas = new Map();
    desatualizada = false;
    ocupado = false;
    selecaoCard.hidden = true;
    resultado.hidden = true;
    lista.replaceChildren();
    linhasResultado.replaceChildren();
    linhas.clear();
    resumo.textContent = '';
    erroGeral.textContent = '';
    atualizarContagem();
    atualizarControles();
  }

  limpar();
  return {
    reiniciar: limpar,
    encerrar: limpar,
    definirPasta(dir) {
      if (!pasta.value.trim() || pasta.value === pastaPadrao) pasta.value = dir;
      pastaPadrao = dir;
      atualizarControles();
    },
  };
}
