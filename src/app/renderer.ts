import type { Passo } from '../core/rastro.js';
import {
  DOC_LABEL,
  type DocTipo,
  type EscolhaPedido,
  montarSelecao,
  reconstruirEscolhas,
  selecaoParaGerar,
  TODOS_DOCS,
} from '../processes/bling/selecao.js';
import type { DocResult, PedidoSelecao, RpaApi } from './api.js';

declare global {
  interface Window {
    rpa: RpaApi;
  }
}

const STATUS_LABEL: Record<DocResult['status'], string> = {
  pendente: 'Aguardando',
  processando: 'Processando…',
  ok: 'Concluído',
  erro: 'Erro',
};

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const numeros = $<HTMLTextAreaElement>('numeros');
const de = $<HTMLInputElement>('de');
const ate = $<HTMLInputElement>('ate');
const confirmar = $<HTMLButtonElement>('confirmar');
const contagem = $('contagem');
const selecaoCard = $('selecao');
const aviso = $('aviso');
const pedidos = $('pedidos');
const resumoSelecao = $('resumo-selecao');
const pasta = $<HTMLInputElement>('pasta');
const escolher = $<HTMLButtonElement>('escolher');
const gerar = $<HTMLButtonElement>('gerar');
const abrir = $<HTMLButtonElement>('abrir');
const resumo = $('resumo');
const erroGeral = $('erro-geral');
const resultado = $('resultado');
const itens = $('itens');

let running = false;
/** Vem de `defaults()`; enquanto estiver vazio, a seleção não pode ser confirmada. */
let docsDisponiveis: DocTipo[] = [];
/** Escolhas da lista de confirmação, na ordem dos pedidos. */
let escolhas = new Map<string, EscolhaPedido>();
/** O texto ou o intervalo mudou depois da última confirmação. */
let desatualizada = false;

type ControlesPedido = {
  bloco: HTMLElement;
  pedido: HTMLInputElement;
  docs: Map<DocTipo, HTMLInputElement>;
};
const controles = new Map<string, ControlesPedido>();
const linhas = new Map<string, HTMLTableRowElement>();
const chave = (numero: string, doc: DocTipo) => `${numero}:${doc}`;

/** Prévia do que será confirmado, atualizada enquanto o usuário digita. */
function atualizarContagem() {
  const {
    numeros: lista,
    invalidos,
    erroIntervalo,
  } = montarSelecao(numeros.value, de.value, ate.value);
  const partes: string[] = [];
  if (lista.length) partes.push(`${lista.length} pedido(s)`);
  if (invalidos.length) partes.push(`Ignorados (não são números): ${invalidos.join(', ')}`);
  if (erroIntervalo) partes.push(`Intervalo: ${erroIntervalo}`);
  contagem.textContent = partes.join(' · ');
  contagem.classList.toggle('warn', invalidos.length > 0 || erroIntervalo !== undefined);
}

/** Habilita ou trava cada controle conforme a execução, a seleção e a pasta. */
function atualizarControles() {
  for (const el of [numeros, de, ate, pasta, escolher]) el.disabled = running;
  confirmar.disabled = running || docsDisponiveis.length === 0;
  aviso.hidden = !desatualizada;
  selecaoCard.classList.toggle('desatualizada', desatualizada);

  for (const [numero, { bloco, pedido, docs }] of controles) {
    const { marcado } = escolhas.get(numero)!;
    pedido.disabled = running;
    bloco.classList.toggle('desmarcado', !marcado);
    for (const [doc, input] of docs) {
      input.disabled = running || !marcado || !docsDisponiveis.includes(doc);
    }
  }

  const selecao = selecaoParaGerar(escolhas);
  const totalDocs = selecao.reduce((total, { docs }) => total + docs.length, 0);
  resumoSelecao.textContent = `${selecao.length} pedido(s) e ${totalDocs} documento(s) selecionado(s)`;
  gerar.disabled = running || desatualizada || selecao.length === 0 || !pasta.value.trim();
}

function criarCheck(texto: string, marcado: boolean, onChange: (marcado: boolean) => void) {
  const label = document.createElement('label');
  label.className = 'check';
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = marcado;
  input.addEventListener('change', () => {
    onChange(input.checked);
    atualizarControles();
  });
  label.append(input, texto);
  return { label, input };
}

/** Desenha a lista de confirmação a partir de `escolhas`. */
function montarLista() {
  pedidos.replaceChildren();
  controles.clear();
  for (const [numero, escolha] of escolhas) {
    const bloco = document.createElement('div');
    bloco.className = 'pedido';
    const pedido = criarCheck(`Pedido ${numero}`, escolha.marcado, (marcado) => {
      escolha.marcado = marcado;
    });
    pedido.label.classList.add('pedido-check');

    const linhaDocs = document.createElement('div');
    linhaDocs.className = 'pedido-docs';
    const docs = new Map<DocTipo, HTMLInputElement>();
    for (const doc of TODOS_DOCS) {
      const check = criarCheck(DOC_LABEL[doc], escolha.docs.has(doc), (marcado) => {
        if (marcado) escolha.docs.add(doc);
        else escolha.docs.delete(doc);
      });
      if (!docsDisponiveis.includes(doc)) {
        const emBreve = document.createElement('span');
        emBreve.className = 'em-breve';
        emBreve.textContent = 'em breve';
        check.label.classList.add('indisponivel');
        check.label.title = 'Ainda não disponível';
        check.label.append(emBreve);
      }
      linhaDocs.append(check.label);
      docs.set(doc, check.input);
    }

    bloco.append(pedido.label, linhaDocs);
    pedidos.append(bloco);
    controles.set(numero, { bloco, pedido: pedido.input, docs });
  }
}

function confirmarSelecao() {
  const { numeros: lista, erroIntervalo } = montarSelecao(numeros.value, de.value, ate.value);
  const problema = erroIntervalo
    ? `Intervalo: ${erroIntervalo}`
    : lista.length === 0
      ? 'Informe ao menos um número de pedido.'
      : undefined;
  if (problema) {
    contagem.textContent = problema;
    contagem.classList.add('warn');
    return;
  }
  escolhas = reconstruirEscolhas(lista, escolhas, docsDisponiveis);
  desatualizada = false;
  montarLista();
  selecaoCard.hidden = false;
  atualizarControles();
}

function onEntradaAlterada() {
  atualizarContagem();
  if (!selecaoCard.hidden) desatualizada = true;
  atualizarControles();
}

const nomeArquivo = (arquivo: string) => arquivo.split(/[\\/]/).pop() ?? '';

function div(className: string, texto: string) {
  const el = document.createElement('div');
  el.className = className;
  el.textContent = texto;
  return el;
}

/** Passo a passo do documento com erro; o erro do passo só aparece se diferir do erro geral. */
function renderPassos(passos: Passo[], erro: string | undefined) {
  const details = document.createElement('details');
  details.className = 'passos';
  details.open = true;
  const summary = document.createElement('summary');
  summary.textContent = 'Passo a passo';
  const lista = document.createElement('ol');
  for (const passo of passos) {
    const li = document.createElement('li');
    li.className = `passo ${passo.status}`;
    const marca = document.createElement('span');
    marca.className = 'marca';
    marca.textContent = passo.status === 'ok' ? '✔' : '✖';
    li.append(marca, passo.texto);
    if (passo.erro && passo.erro !== erro) li.append(div('passo-erro', passo.erro));
    lista.append(li);
  }
  details.append(summary, lista);
  return details;
}

function renderItem(item: DocResult) {
  const tr = linhas.get(chave(item.numero, item.doc));
  if (!tr) return;
  const [, , status, detalhe] = tr.cells;
  const chip = document.createElement('span');
  chip.textContent = STATUS_LABEL[item.status];
  chip.className = `status ${item.status}`;
  status!.replaceChildren(chip);

  const conteudo: Node[] = [];
  if (item.status === 'erro') {
    conteudo.push(div('erro-msg', item.erro ?? 'Erro desconhecido'));
    if (item.passos?.length) conteudo.push(renderPassos(item.passos, item.erro));
  } else {
    for (const arquivo of item.arquivos ?? []) conteudo.push(div('arquivo', nomeArquivo(arquivo)));
    if (item.detalhe) conteudo.push(div('', item.detalhe));
  }
  detalhe!.replaceChildren(...conteudo);
}

/** Uma linha por documento, agrupadas por pedido (o número aparece na primeira do grupo). */
function montarResultados(selecao: PedidoSelecao[]) {
  itens.replaceChildren();
  linhas.clear();
  for (const { numero, docs } of selecao) {
    docs.forEach((doc, index) => {
      const tr = document.createElement('tr');
      for (let i = 0; i < 4; i++) tr.appendChild(document.createElement('td'));
      if (index === 0) {
        tr.className = 'grupo';
        tr.cells[0]!.textContent = numero;
      }
      tr.cells[1]!.textContent = DOC_LABEL[doc];
      itens.appendChild(tr);
      linhas.set(chave(numero, doc), tr);
      renderItem({ numero, doc, status: 'pendente' });
    });
  }
  resultado.hidden = selecao.length === 0;
}

function setRunning(value: boolean) {
  running = value;
  atualizarControles();
}

window.rpa.onProgresso(renderItem);

for (const el of [numeros, de, ate]) el.addEventListener('input', onEntradaAlterada);
for (const el of [de, ate]) {
  el.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !confirmar.disabled) confirmarSelecao();
  });
}
confirmar.addEventListener('click', confirmarSelecao);
pasta.addEventListener('input', atualizarControles);

escolher.addEventListener('click', async () => {
  const escolhida = await window.rpa.escolherPasta(pasta.value);
  if (escolhida) pasta.value = escolhida;
  atualizarControles();
});

abrir.addEventListener('click', async () => {
  erroGeral.textContent = '';
  try {
    await window.rpa.abrirPasta(pasta.value);
  } catch (error) {
    erroGeral.textContent = `Não foi possível abrir a pasta: ${(error as Error).message}`;
  }
});

gerar.addEventListener('click', async () => {
  const selecao = selecaoParaGerar(escolhas);
  erroGeral.textContent = '';
  resumo.textContent = 'Executando… o Chrome será aberto pelo robô.';
  montarResultados(selecao);
  setRunning(true);
  try {
    const { results } = await window.rpa.gerar(selecao, pasta.value);
    results.forEach(renderItem);
    const ok = results.filter((r) => r.status === 'ok').length;
    resumo.textContent = `${ok} de ${results.length} documento(s) gerado(s).`;
  } catch (error) {
    resumo.textContent = '';
    // O Electron prefixa a mensagem com "Error invoking remote method '...': Error: ".
    erroGeral.textContent = (error as Error).message.replace(/^.*?Error: /, '');
  } finally {
    setRunning(false);
  }
});

void window.rpa.defaults().then((defaults) => {
  pasta.value = defaults.destDir;
  docsDisponiveis = defaults.docsDisponiveis;
  atualizarContagem();
  atualizarControles();
});
