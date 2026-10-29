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
import type {
  ConfigTela,
  DocResult,
  EmpresaAtualTela,
  PedidoSelecao,
  RpaApi,
  SessaoTela,
} from './api.js';
import { podeTrocarEmpresa, tituloJanela } from './empresa.js';
import type { Perfil } from './plataforma/contratos.js';
import { criarArtes } from './artes/index.js';
import { mensagemErro } from './artes/dom.js';
import { abaInicial, abasDoPerfil, type Automacao, ordenarMenu } from './menu.js';

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
const abrirConfig = $<HTMLButtonElement>('abrir-config');
const dialogConfig = $<HTMLDialogElement>('config');
const formConfig = $<HTMLFormElement>('config-form');
const cfgUsuario = $<HTMLInputElement>('cfg-usuario');
const cfgSenha = $<HTMLInputElement>('cfg-senha');
const cfgSenhaHint = $('cfg-senha-hint');
const cfgPasta = $<HTMLInputElement>('cfg-pasta');
const cfgEscolher = $<HTMLButtonElement>('cfg-escolher');
const cfgChrome = $<HTMLInputElement>('cfg-chrome');
const cfgErro = $('cfg-erro');
const cfgSalvar = $<HTMLButtonElement>('cfg-salvar');
const cfgCancelar = $<HTMLButtonElement>('cfg-cancelar');
const atualizacao = $('atualizacao');
const atualizacaoTexto = $('atualizacao-texto');
const reiniciar = $<HTMLButtonElement>('reiniciar');
const versao = $('versao');
const menu = $('menu');
const carregando = $('carregando');
const telaLogin = $('login');
const formLogin = $<HTMLFormElement>('login-form');
const loginEmail = $<HTMLInputElement>('login-email');
const loginSenha = $<HTMLInputElement>('login-senha');
const loginErro = $('login-erro');
const loginEntrar = $<HTMLButtonElement>('login-entrar');
const topo = $('topo');
const areaApp = $('app');
const faixaOffline = $('offline');
const artesOffline = $('artes-offline');
const artes = criarArtes($('artes-raiz'), window.rpa.artes);
const usuarioEl = $('usuario');
const usuarioNome = $('usuario-nome');
const sair = $<HTMLButtonElement>('sair');
const cfgCampos = $('cfg-campos');
const logo = $<HTMLImageElement>('logo');
const empresaSubtitulo = $('empresa-subtitulo');
const rodapeEmpresa = $('rodape-empresa');
const empresaBtn = $<HTMLButtonElement>('empresa');
const empresaNome = $('empresa-nome');
const empresaSeta = $('empresa-seta');
const dialogEmpresas = $<HTMLDialogElement>('empresas');
const empresasLista = $('empresas-lista');
const empresasCancelar = $<HTMLButtonElement>('empresas-cancelar');

let running = false;
/** Quantas empresas o usuário logado tem; o seletor só abre com mais de uma. */
let totalEmpresas = 0;
/** Vem de `defaults()`; enquanto estiver vazio, a seleção não pode ser confirmada. */
let docsDisponiveis: DocTipo[] = [];
/** Escolhas da lista de confirmação, na ordem dos pedidos. */
let escolhas = new Map<string, EscolhaPedido>();
/** O texto ou o intervalo mudou depois da última confirmação. */
let desatualizada = false;
/** Pasta padrão das Configurações; "Salvar documentos em" a acompanha enquanto não for alterado. */
let pastaPadrao = '';

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
  for (const el of [numeros, de, ate, pasta, escolher, abrirConfig, reiniciar, sair]) {
    el.disabled = running;
  }
  empresaBtn.disabled = !podeTrocarEmpresa(running, totalEmpresas);
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

/** Mostra só a seção da aba `id`. As outras ficam escondidas, sem perder o estado. */
function selecionarAba(id: Automacao['id']) {
  for (const secao of document.querySelectorAll<HTMLElement>('section[data-aba]')) {
    secao.hidden = secao.dataset.aba !== id;
  }
  for (const botao of menu.querySelectorAll<HTMLButtonElement>('button')) {
    if (botao.dataset.aba === id) botao.setAttribute('aria-current', 'page');
    else botao.removeAttribute('aria-current');
  }
}

/** Monta o menu com as abas do perfil e abre na primeira delas. */
function montarMenu(perfil: Perfil) {
  const abas = abasDoPerfil(perfil);
  for (const botao of menu.querySelectorAll('button[data-aba]')) botao.remove();
  // O menu fica clicável mesmo com uma geração em andamento: trocar de aba não a interrompe.
  for (const automacao of ordenarMenu(abas)) {
    const botao = document.createElement('button');
    botao.type = 'button';
    botao.textContent = automacao.rotulo;
    botao.dataset.aba = automacao.id;
    botao.addEventListener('click', () => selecionarAba(automacao.id));
    usuarioEl.before(botao);
  }
  selecionarAba(abaInicial(abas).id);
}

window.rpa.onProgresso(renderItem);
window.rpa.onAtualizacao((nova) => {
  atualizacaoTexto.textContent = `Nova versão ${nova} baixada.`;
  atualizacao.hidden = false;
});
reiniciar.addEventListener('click', async () => {
  cfgErro.textContent = '';
  try {
    await window.rpa.instalarAtualizacao();
  } catch (error) {
    cfgErro.textContent = mensagemErro(error);
  }
});

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
    erroGeral.textContent = mensagemErro(error);
  } finally {
    setRunning(false);
  }
});

function preencherConfig(config: ConfigTela) {
  cfgUsuario.value = config.blingUser;
  cfgSenha.value = '';
  cfgSenhaHint.textContent = config.temSenha
    ? 'Senha salva. Deixe vazio para mantê-la.'
    : 'Nenhuma senha salva.';
  cfgPasta.value = config.destDir;
  cfgChrome.value = config.chromePath;
  cfgChrome.placeholder = config.chromePadrao;
  cfgErro.textContent = '';
}

async function abrirConfiguracoes(config?: ConfigTela) {
  preencherConfig(config ?? (await window.rpa.obterConfig()));
  dialogConfig.showModal();
}

abrirConfig.addEventListener('click', () => void abrirConfiguracoes());
cfgCancelar.addEventListener('click', () => dialogConfig.close());
cfgEscolher.addEventListener('click', async () => {
  const escolhida = await window.rpa.escolherPasta(cfgPasta.value);
  if (escolhida) cfgPasta.value = escolhida;
});

formConfig.addEventListener('submit', async (event) => {
  event.preventDefault();
  cfgSalvar.disabled = true;
  cfgErro.textContent = '';
  try {
    const config = await window.rpa.salvarConfig({
      blingUser: cfgUsuario.value,
      blingPassword: cfgSenha.value,
      destDir: cfgPasta.value,
      chromePath: cfgChrome.value,
    });
    if (!pasta.value.trim() || pasta.value === pastaPadrao) pasta.value = config.destDir;
    pastaPadrao = config.destDir;
    dialogConfig.close();
    atualizarControles();
  } catch (error) {
    cfgErro.textContent = mensagemErro(error);
  } finally {
    cfgSalvar.disabled = false;
  }
});

/** Configurações e padrões do admin; só depois de entrar, pois dependem do perfil. */
async function carregarAdmin() {
  const defaults = await window.rpa.defaults();
  pasta.value = defaults.destDir;
  pastaPadrao = defaults.destDir;
  docsDisponiveis = defaults.docsDisponiveis;
  atualizarContagem();
  atualizarControles();
  // Empresa sem usuário, senha ou pasta do Bling: abre as Configurações (não bloqueia; a execução valida).
  const config = await window.rpa.obterConfig();
  if (config.falta) await abrirConfiguracoes(config);
}

/** Nada de pedidos ou resultados do usuário ou da empresa anterior na tela da próxima. */
function limparFatura() {
  docsDisponiveis = [];
  for (const el of [numeros, de, ate, pasta]) el.value = '';
  escolhas = new Map();
  desatualizada = false;
  selecaoCard.hidden = true;
  resultado.hidden = true;
  resumo.textContent = '';
  erroGeral.textContent = '';
}

/** Aplica nome, logo, tema e título da empresa em uso; sem empresa, volta ao visual padrão. */
function aplicarEmpresa(empresa: EmpresaAtualTela | undefined, total: number) {
  const raiz = document.documentElement;
  totalEmpresas = total;
  if (empresa) {
    raiz.dataset.empresa = empresa.slug;
    raiz.style.setProperty('--aba-red', empresa.tema.primaria);
    raiz.style.setProperty('--aba-red-dark', empresa.tema.primariaEscura);
    raiz.style.setProperty('--aba-green', empresa.tema.destaque);
    raiz.style.setProperty('--aba-green-dark', empresa.tema.destaqueEscura);
  } else {
    delete raiz.dataset.empresa;
    for (const nome of ['--aba-red', '--aba-red-dark', '--aba-green', '--aba-green-dark']) {
      raiz.style.removeProperty(nome);
    }
  }
  logo.hidden = !empresa?.logo;
  if (empresa?.logo) {
    logo.src = empresa.logo;
    logo.alt = empresa.nome;
  }
  empresaSubtitulo.textContent = empresa ? `${empresa.nome} · Bling` : '';
  rodapeEmpresa.textContent = empresa?.nome ?? 'Automações';
  empresaNome.textContent = empresa?.nome ?? 'Sem empresa';
  empresaSeta.hidden = totalEmpresas < 2;
  document.title = tituloJanela(empresa?.nome);
}

/** E-mail e perfil da sessão que a tela já montou; evita refazer o menu a cada aviso igual. */
let montadoPara: string | undefined;
/** Usuário, perfil e empresa para os quais a tela já carregou o Bling; trocar a empresa recarrega. */
let empresaMontada: string | undefined;

/** Alterna entre login e app, e ajusta menu, faixa offline e Configurações ao perfil. */
function aplicarSessao(sessao: SessaoTela) {
  carregando.hidden = true;
  const logado = sessao.situacao !== 'deslogado';
  telaLogin.hidden = logado;
  topo.hidden = !logado;
  areaApp.hidden = !logado;
  if (!logado) {
    montadoPara = undefined;
    empresaMontada = undefined;
    artes.encerrar();
    aplicarEmpresa(undefined, 0);
    dialogEmpresas.close();
    limparFatura();
    atualizarContagem();
    dialogConfig.close();
    loginSenha.value = '';
    loginEmail.focus();
    return;
  }

  const offline = sessao.situacao === 'offline';
  faixaOffline.hidden = !offline;
  artesOffline.hidden = !offline;
  const admin = sessao.perfil === 'admin';
  cfgCampos.hidden = !admin;
  cfgSalvar.hidden = !admin;
  usuarioNome.textContent = sessao.nome;

  aplicarEmpresa(sessao.empresa, sessao.empresas.length);
  atualizarControles();

  const chaveSessao = `${sessao.email}:${sessao.perfil}`;
  if (montadoPara !== chaveSessao) {
    montadoPara = chaveSessao;
    montarMenu(sessao.perfil);
  }
  const chaveEmpresa = `${chaveSessao}:${sessao.empresa?.slug ?? ''}`;
  if (empresaMontada === chaveEmpresa) return;
  empresaMontada = chaveEmpresa;
  artes.reiniciar();
  limparFatura();
  atualizarContagem();
  // Arte finalista nunca vê o modal do Bling.
  if (admin) void carregarAdmin().catch((error) => (cfgErro.textContent = mensagemErro(error)));
}

formLogin.addEventListener('submit', async (event) => {
  event.preventDefault();
  loginEntrar.disabled = true;
  loginErro.textContent = '';
  try {
    aplicarSessao(await window.rpa.entrar(loginEmail.value, loginSenha.value));
  } catch (error) {
    loginErro.textContent = mensagemErro(error);
  } finally {
    loginEntrar.disabled = false;
  }
});

empresaBtn.addEventListener('click', () => {
  if (!podeTrocarEmpresa(running, totalEmpresas)) return;
  void window.rpa.sessaoEstado().then((sessao) => {
    if (sessao.situacao === 'deslogado') return;
    empresasLista.replaceChildren(
      ...sessao.empresas.map((empresa) => {
        const botao = document.createElement('button');
        botao.type = 'button';
        botao.textContent = empresa.nome;
        botao.setAttribute('aria-current', String(empresa.slug === sessao.empresa?.slug));
        botao.addEventListener('click', async () => {
          try {
            aplicarSessao(await window.rpa.trocarEmpresa(empresa.slug));
            dialogEmpresas.close();
          } catch (error) {
            erroGeral.textContent = mensagemErro(error);
            dialogEmpresas.close();
          }
        });
        return botao;
      }),
    );
    dialogEmpresas.showModal();
  });
});
empresasCancelar.addEventListener('click', () => dialogEmpresas.close());

sair.addEventListener('click', async () => {
  try {
    await window.rpa.sair();
    aplicarSessao({ situacao: 'deslogado' });
  } catch (error) {
    erroGeral.textContent = mensagemErro(error);
  }
});

window.rpa.onSessaoMudou(aplicarSessao);
void window.rpa.defaults().then((defaults) => (versao.textContent = ` · v${defaults.versao}`));
void window.rpa.sessaoEstado().then(aplicarSessao);
