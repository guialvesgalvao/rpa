import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { access, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  safeStorage,
  shell,
  type OpenDialogOptions,
} from 'electron';
import electronUpdater from 'electron-updater';

import { type Config, loadConfig } from '../config/env.js';
import { withPaginaOculta } from '../core/browser.js';
import { createLogger } from '../core/logger.js';
import { DOCS_DISPONIVEIS, gerarDocumentos } from '../processes/bling/documentos.js';
import { mockAtivo, type PedidoOp } from '../processes/bling/pedido-op.js';
import { gerarOps, type ItemGeracao } from '../processes/op/gerar.js';
import { lerPedidosBling, lerPedidosMock, type PedidoLido } from '../processes/op/pedidos.js';
import { salvarPdfOp } from '../processes/op/pdf.js';
import type { ImagemOp } from '../processes/op/tipos.js';
import { ensureDir } from '../utils/fs.js';
import {
  type ArquivoEscolhido,
  CHANNELS,
  type CadastroResultado,
  type ConclusaoResultado,
  type ConfigTela,
  type Defaults,
  type GerarOpResultado,
  type GerarResultado,
  type ItemParaGerarOp,
  type PedidoOpTela,
  type ProgressoBlingTela,
  type ResultadoSincronizacaoBling,
  type SessaoTela,
  type StatusAutomaticaBling,
} from './api.js';
import { logoDaEmpresa, podeTrocarEmpresa, rotuloEmpresa } from './empresa.js';
import { podeSincronizarBling, podeUsarOp } from './menu.js';
import {
  type ArquivoLocal,
  type ArtesDoItem,
  artesDoItem,
  criarClienteArtes,
  ErroRequisicao,
  type ErrosCadastro,
  errosDaRejeicao,
  inspecionarArquivo,
  montarEnvio,
  montarEnvioComentario,
  type OpcoesArte,
} from './plataforma/artes.js';
import {
  acompanharSincronizacao,
  criarClienteBling,
  urlAutorizacaoSegura,
} from './plataforma/bling.js';
import { criarCliente, ErroIndisponivel, ErroRecusado } from './plataforma/cliente.js';
import { montarPedidosTela } from './plataforma/op.js';
import {
  type ArteDoProduto,
  type Cliente,
  type ComentarioTarefa,
  type ContagemTarefas,
  type EventoTarefa,
  type PaginaClientes,
  type Perfil,
  type ProdutoDoCliente,
  type Tarefa,
  type TarefaDetalhe,
  temaDaEmpresa,
  type UsuarioResumo,
} from './plataforma/contratos.js';
import { criarSessao, type EstadoSessao } from './plataforma/sessao.js';
import { urlDaApi } from './plataforma/url.js';
import {
  atualizarSettings,
  type Cifra,
  configAtual as montarConfig,
  definirEmpresaAtual,
  empresaAtual,
  faltaConfig,
  lerSettings,
  paraTela as paraTelaConfig,
  salvarSettings,
  settingsDaEmpresa,
} from './settings.js';
import {
  type CadastroEntrada,
  validarCadastro,
  validarAnexoParaBaixar,
  validarComentario,
  validarConclusao,
  validarConsultaTarefas,
  validarMudancaStatus,
  validarNovaTarefa,
  validarNovoUsuario,
  validarTrocaSenha,
  validarConsultaClientes,
  validarId,
  validarLogin,
  validarCnpj,
  validarItemOp,
  validarItensOp,
  validarNumerosOp,
  validarSelecao,
  validarSlug,
  validarTipoArquivo,
} from './validacao.js';

// Compilado em dist/app/, junto com index.html e assets/.
const here = path.dirname(fileURLToPath(import.meta.url));
// Caminhos relativos do .env (data/, logs/...): raiz do projeto em dev; no app instalado, a pasta
// de dados do usuário (%APPDATA%\RPA Bling), já que a pasta de instalação pode não ter escrita.
const baseDir = app.isPackaged ? app.getPath('userData') : path.resolve(here, '../..');

const envConfig = loadConfig(process.env, baseDir);
// No app instalado não há .env: a pasta padrão dos documentos fica em Documentos\RPA Bling.
if (app.isPackaged && !process.env.BLING_BOLETOS_DIR) {
  envConfig.bling.boletosDir = path.join(app.getPath('documents'), 'RPA Bling');
}
const logger = createLogger('bling-app', envConfig.logLevel, envConfig.logsDir, {
  console: !app.isPackaged,
});
let running = false;

// Configurações da tela (usuário/senha/pasta do Bling por usuário e empresa; Chrome); valem sobre o .env.
const settingsFile = path.join(baseDir, 'data', 'settings.json');
const dirDados = path.join(baseDir, 'data');
// `shouldReEncrypt` é ignorado: cada salvamento regrava o texto cifrado de novo.
const cifra: Cifra = {
  disponivel: () => safeStorage.isEncryptionAvailable(),
  cifrar: async (texto) => (await safeStorage.encryptStringAsync(texto)).toString('base64'),
  decifrar: async (cifrado) =>
    (await safeStorage.decryptStringAsync(Buffer.from(cifrado, 'base64'))).result,
};

// Sessão na API da plataforma: o token de renovação fica cifrado em data/sessao.json.
const sessao = criarSessao({
  cliente: criarCliente({ baseUrl: urlDaApi(), fetch }),
  cifra,
  arquivo: path.join(baseDir, 'data', 'sessao.json'),
  relogio: () => new Date(),
});
// Reabre a sessão salva em paralelo à janela (sem rede, a renovação pode levar até o timeout);
// a tela pede o estado e espera por isto.
const sessaoIniciada: Promise<unknown> = app
  .whenReady()
  .then(() => sessao.iniciar())
  .catch((erro: unknown) =>
    logger.error({ erro: (erro as Error).message }, 'Falha ao iniciar a sessão'),
  );
const INTERVALO_SESSAO_MS = 5 * 60 * 1000;

// Artes: a janela não faz `fetch` (CSP); o main chama a API com o acesso da sessão.
async function obterAcessoApi(): Promise<string> {
  const acesso = await sessao.obterAcesso();
  if (acesso) return acesso;
  if (sessao.estado().situacao === 'deslogado') {
    throw new Error('Sessão encerrada. Entre novamente.');
  }
  throw new ErroIndisponivel('Sem conexão com o servidor.');
}
const artesApi = criarClienteArtes({ baseUrl: urlDaApi(), fetch, obterAcesso: obterAcessoApi });
// Sincronização com o Bling: pela API da plataforma (o app nunca fala com o Bling por esta via).
const blingApi = criarClienteBling({ baseUrl: urlDaApi(), fetch, obterAcesso: obterAcessoApi });
/** Arquivos escolhidos nos diálogos: a janela só conhece o id, nunca o caminho. */
const arquivosEscolhidos = new Map<string, ArquivoLocal>();

const ICONE_PADRAO = path.join(here, 'assets', 'logo-aba.png');
let iconeAtual = ICONE_PADRAO;

/** O ícone da janela (e da barra de tarefas) acompanha a empresa em uso; sem logo, o da ABA. */
function atualizarIcone(slug: string | undefined): void {
  const logo = slug === undefined ? undefined : logoDaEmpresa(slug);
  const icone = logo ? path.join(here, logo) : ICONE_PADRAO;
  if (icone === iconeAtual) return;
  iconeAtual = icone;
  // `setIcon` só existe no Windows e no Linux.
  if (process.platform === 'darwin') return;
  for (const janela of BrowserWindow.getAllWindows()) {
    if (!janela.isDestroyed()) janela.setIcon(icone);
  }
}

/** A sessão como a tela vê, com a empresa em uso (a última escolhida, ou a primeira) e o tema dela. */
async function paraTela(estado: EstadoSessao): Promise<SessaoTela> {
  if (estado.situacao === 'deslogado') {
    atualizarIcone(undefined);
    return estado;
  }
  const { id, nome, email, perfil, empresas, deveTrocarSenha } = estado.perfil;
  const slug = empresaAtual(
    await lerSettings(settingsFile),
    id,
    empresas.map((e) => e.slug),
  );
  const atual = empresas.find((e) => e.slug === slug);
  atualizarIcone(atual?.slug);
  return {
    situacao: estado.situacao,
    nome,
    email,
    perfil,
    empresas,
    deveTrocarSenha,
    empresa: atual && {
      slug: atual.slug,
      nome: rotuloEmpresa(atual.nome, atual.slug),
      tema: temaDaEmpresa(atual.slug),
      logo: logoDaEmpresa(atual.slug),
    },
  };
}

/** A Fatura é só do admin; vale o perfil da sessão (em cache, se offline). */
function exigirAdmin(): void {
  const estado = sessao.estado();
  if (estado.situacao === 'deslogado' || estado.perfil.perfil !== 'admin') {
    throw new Error('Sem permissão.');
  }
}

/** Usuário da sessão e a empresa em uso (a última escolhida, ou a primeira dele). */
async function contexto(): Promise<{ usuarioId: string; empresa: string; perfil: Perfil }> {
  const estado = sessao.estado();
  if (estado.situacao === 'deslogado') throw new Error('Sem permissão.');
  const { id, empresas, perfil } = estado.perfil;
  const empresa = empresaAtual(
    await lerSettings(settingsFile),
    id,
    empresas.map((e) => e.slug),
  );
  if (!empresa) throw new Error('Seu usuário não tem empresa vinculada.');
  return { usuarioId: id, empresa, perfil };
}

/** A OP é só do admin da Roma; repete no main a regra do menu. Devolve a empresa em uso. */
async function exigirOp(): Promise<string> {
  const { empresa, perfil } = await contexto();
  if (!podeUsarOp(perfil, empresa)) throw new Error('Sem permissão.');
  return empresa;
}

/** A sincronização com o Bling é só do admin da Roma; repete no main a regra da tela. */
async function exigirSincronizacao(): Promise<string> {
  const { empresa, perfil } = await contexto();
  if (!podeSincronizarBling(perfil, empresa)) throw new Error('Sem permissão.');
  return empresa;
}

/**
 * Última busca da aba OP. A geração monta as OPs com estes pedidos e artes, nunca com dados vindos
 * da janela: ela só indica pedido, posição do item e id da arte.
 */
const op = {
  empresa: undefined as string | undefined,
  pedidos: new Map<string, { pedido: PedidoOp; clienteId: string | null }>(),
  artes: new Map<string, ArteDoProduto[]>(),
};
const chaveArtes = (clienteId: string, codigo: string) => `${clienteId}:${codigo.trim()}`;

function limparBuscaOp(): void {
  op.empresa = undefined;
  op.pedidos.clear();
  op.artes.clear();
}

function guardarBusca(empresa: string, lidos: PedidoLido[], telas: PedidoOpTela[]): void {
  limparBuscaOp();
  op.empresa = empresa;
  for (const lido of lidos) {
    if (!('pedido' in lido)) continue;
    const tela = telas.find((t) => t.numero === lido.numero);
    const clienteId = tela?.situacao === 'ok' ? (tela.cliente?.id ?? null) : null;
    op.pedidos.set(lido.numero, { pedido: lido.pedido, clienteId });
    if (tela?.situacao !== 'ok' || !clienteId) continue;
    for (const item of tela.itens) op.artes.set(chaveArtes(clienteId, item.codigo), item.artes);
  }
}

/** Item da última busca com a arte escolhida; recusa pedido, item ou arte que o main não conhece. */
function itemParaGerar({ numero, indice, arteId, preenchimento }: ItemParaGerarOp): ItemGeracao {
  const guardado = op.pedidos.get(numero);
  const item = guardado?.pedido.itens[indice];
  if (!guardado || !item) throw new Error('Busque os pedidos de novo.');
  const extra = preenchimento ? { preenchimento } : {};
  if (!arteId) return { pedido: guardado.pedido, indice, ...extra };
  const arte = guardado.clienteId
    ? op.artes.get(chaveArtes(guardado.clienteId, item.codigo))?.find((a) => a.id === arteId)
    : undefined;
  if (!arte) throw new Error('Arte não encontrada. Busque os pedidos de novo.');
  return {
    pedido: guardado.pedido,
    indice,
    arte: {
      id: arte.id,
      cor: arte.cor.nome,
      maquinas: arte.maquinas.map((m) => m.nome),
      temImagem: arte.temImagem,
    },
    ...extra,
  };
}

/**
 * Configuração da execução (Bling, Chrome, pastas) do usuário na empresa em uso. Com `credenciais`,
 * exige usuário, senha e pasta do Bling (o robô vai entrar nele).
 */
async function configDoBling(credenciais: boolean): Promise<Config> {
  const { usuarioId, empresa, perfil } = await contexto();
  const settings = await lerSettings(settingsFile);
  if (credenciais && faltaConfig(perfil, settingsDaEmpresa(settings, usuarioId, empresa))) {
    throw new Error('Preencha o usuário, a senha e a pasta do Bling em Configurações.');
  }
  const config = await montarConfig(envConfig, settings, usuarioId, empresa, dirDados, cifra);
  if (credenciais && (!config.bling.user || !config.bling.password)) {
    throw new Error('Preencha o usuário e a senha do Bling em Configurações.');
  }
  return config;
}

/** Pasta de destino criada e com escrita; senão, mensagem pronta para a tela. */
async function pastaGravavel(destDir: unknown): Promise<string> {
  if (typeof destDir !== 'string' || !destDir.trim()) {
    throw new Error('Escolha a pasta de destino.');
  }
  const pasta = path.resolve(destDir);
  try {
    await ensureDir(pasta);
    await access(pasta, constants.W_OK);
  } catch {
    throw new Error(`Não foi possível usar a pasta "${pasta}". Escolha outra pasta.`);
  }
  return pasta;
}

const { autoUpdater } = electronUpdater;
const INTERVALO_ATUALIZACAO_MS = 4 * 60 * 60 * 1000;

ipcMain.handle(CHANNELS.defaults, async (): Promise<Defaults> => {
  let destDir = '';
  if (sessao.estado().situacao !== 'deslogado') {
    const { usuarioId, empresa } = await contexto().catch(() => ({ usuarioId: '', empresa: '' }));
    destDir = empresa
      ? (
          await montarConfig(
            envConfig,
            await lerSettings(settingsFile),
            usuarioId,
            empresa,
            dirDados,
            cifra,
          )
        ).bling.boletosDir
      : envConfig.bling.boletosDir;
  }
  return { destDir, docsDisponiveis: DOCS_DISPONIVEIS, versao: app.getVersion() };
});

ipcMain.handle(CHANNELS.obterConfig, async (): Promise<ConfigTela> => {
  exigirAdmin();
  const { usuarioId, empresa } = await contexto();
  const settings = await lerSettings(settingsFile);
  return paraTelaConfig(envConfig, settings, usuarioId, empresa, dirDados, cifra);
});

ipcMain.handle(CHANNELS.salvarConfig, async (_event, input: unknown): Promise<ConfigTela> => {
  exigirAdmin();
  if (running) throw new Error('Aguarde a execução terminar para alterar as configurações.');
  const { usuarioId, empresa } = await contexto();
  const settings = await atualizarSettings(
    await lerSettings(settingsFile),
    usuarioId,
    empresa,
    input,
    cifra,
  );
  await salvarSettings(settingsFile, settings);
  logger.info(
    { empresa, blingUser: settingsDaEmpresa(settings, usuarioId, empresa).blingUser },
    'Configurações salvas',
  );
  return paraTelaConfig(envConfig, settings, usuarioId, empresa, dirDados, cifra);
});

ipcMain.handle(CHANNELS.escolherPasta, async (event, atual: string) => {
  const window = BrowserWindow.fromWebContents(event.sender);
  const options: OpenDialogOptions = {
    defaultPath: atual,
    properties: ['openDirectory', 'createDirectory'],
  };
  const result = window
    ? await dialog.showOpenDialog(window, options)
    : await dialog.showOpenDialog(options);
  return result.canceled ? null : (result.filePaths[0] ?? null);
});

ipcMain.handle(CHANNELS.abrirPasta, async (_event, dir: string) => {
  const erro = await shell.openPath(dir);
  if (erro) throw new Error(erro);
});

ipcMain.handle(
  CHANNELS.gerar,
  async (event, input: unknown, destDir: string): Promise<GerarResultado> => {
    exigirAdmin();
    if (running) throw new Error('Já existe uma execução em andamento.');
    if (typeof destDir !== 'string' || !destDir.trim()) {
      throw new Error('Escolha a pasta de destino.');
    }
    const selecao = validarSelecao(input);
    const config = await configDoBling(true);
    // Valida a pasta antes de abrir o navegador (evita gastar um login no Bling à toa).
    const pasta = await pastaGravavel(destDir);

    running = true;
    logger.info({ pedidos: selecao.length, destDir }, 'Iniciando geração de documentos');
    try {
      const results = await gerarDocumentos({
        config,
        logger,
        selecao,
        destDir: pasta,
        onProgress: (item) => event.sender.send(CHANNELS.progresso, item),
      });
      return { results };
    } finally {
      running = false;
    }
  },
);

ipcMain.handle(CHANNELS.sessaoEstado, async (): Promise<SessaoTela> => {
  await sessaoIniciada;
  return await paraTela(sessao.estado());
});

ipcMain.handle(CHANNELS.sessaoEntrar, async (_event, input: unknown): Promise<SessaoTela> => {
  const { email, senha } = validarLogin(input);
  try {
    return await paraTela(await sessao.entrar(email, senha));
  } catch (erro) {
    // Mensagem genérica: não revela se o e-mail existe nem o motivo da recusa.
    if (erro instanceof ErroRecusado)
      throw new Error('E-mail ou senha inválidos.', { cause: erro });
    if (erro instanceof ErroIndisponivel)
      throw new Error('Sem conexão com o servidor.', { cause: erro });
    logger.error({ erro: (erro as Error).message }, 'Falha ao entrar');
    throw new Error('Não foi possível entrar. Tente novamente.', { cause: erro });
  }
});

ipcMain.handle(CHANNELS.senhaTrocar, async (_event, input: unknown): Promise<SessaoTela> => {
  const { senhaAtual, novaSenha } = validarTrocaSenha(input);
  try {
    const estado = await sessao.trocarSenha(senhaAtual, novaSenha);
    logger.info('Senha trocada pelo usuário');
    return await paraTela(estado);
  } catch (erro) {
    // A recusa da API (senha atual errada, nova repetida, muitas tentativas) já vem em português.
    if (erro instanceof ErroRecusado) throw new Error(erro.message, { cause: erro });
    if (erro instanceof ErroIndisponivel)
      throw new Error('Sem conexão com o servidor.', { cause: erro });
    logger.error({ erro: (erro as Error).message }, 'Falha ao trocar a senha');
    throw new Error('Não foi possível trocar a senha. Tente novamente.', { cause: erro });
  }
});

// Usuários: só o admin; a API confere o perfil e as empresas de novo (lidas do banco).
ipcMain.handle(CHANNELS.usuariosListar, async (): Promise<UsuarioResumo[]> => {
  exigirAdmin();
  return artesApi.listarUsuarios();
});

ipcMain.handle(CHANNELS.usuariosCriar, async (_event, input: unknown): Promise<UsuarioResumo> => {
  exigirAdmin();
  const novo = validarNovoUsuario(input);
  const criado = await artesApi.criarUsuario(novo);
  logger.info({ perfil: criado.perfil }, 'Usuário criado pelo app');
  return criado;
});

ipcMain.handle(CHANNELS.sessaoSair, async () => {
  if (running) throw new Error('Aguarde a execução terminar para sair.');
  limparBuscaOp();
  await sessao.sair();
  atualizarIcone(undefined);
});

ipcMain.handle(CHANNELS.empresaTrocar, async (_event, input: unknown): Promise<SessaoTela> => {
  const slug = validarSlug(input);
  const estado = sessao.estado();
  if (estado.situacao === 'deslogado') throw new Error('Sem permissão.');
  if (!podeTrocarEmpresa(running, estado.perfil.empresas.length)) {
    throw new Error(
      running
        ? 'Aguarde a execução terminar para trocar de empresa.'
        : 'Seu usuário tem uma só empresa.',
    );
  }
  if (!estado.perfil.empresas.some((e) => e.slug === slug)) throw new Error('Empresa inválida.');
  await salvarSettings(
    settingsFile,
    definirEmpresaAtual(await lerSettings(settingsFile), estado.perfil.id, slug),
  );
  logger.info({ empresa: slug }, 'Empresa trocada');
  return await paraTela(estado);
});

// Leitura e cadastro valem para os dois perfis; a API confere a empresa e o perfil de cada rota.
ipcMain.handle(
  CHANNELS.artesListarClientes,
  async (_event, input: unknown): Promise<PaginaClientes> => {
    const consulta = validarConsultaClientes(input);
    const { empresa } = await contexto();
    return artesApi.listarClientes(empresa, consulta);
  },
);

ipcMain.handle(CHANNELS.artesObterCliente, async (_event, input: unknown): Promise<Cliente> => {
  const id = validarId(input);
  const { empresa } = await contexto();
  return artesApi.obterCliente(empresa, id);
});

ipcMain.handle(
  CHANNELS.artesProdutosDoCliente,
  async (_event, input: unknown): Promise<ProdutoDoCliente[]> => {
    const id = validarId(input);
    const { empresa } = await contexto();
    return artesApi.produtosDoCliente(empresa, id);
  },
);

ipcMain.handle(CHANNELS.artesOpcoes, async (): Promise<OpcoesArte> => {
  const { empresa } = await contexto();
  return artesApi.opcoes(empresa);
});

const FILTROS_ARQUIVO = {
  pdf: [{ name: 'PDF', extensions: ['pdf'] }],
  imagem: [{ name: 'Imagem', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
};

ipcMain.handle(
  CHANNELS.artesEscolherArquivo,
  async (event, input: unknown): Promise<ArquivoEscolhido | null> => {
    const tipo = validarTipoArquivo(input);
    await contexto();
    const window = BrowserWindow.fromWebContents(event.sender);
    const options: OpenDialogOptions = { properties: ['openFile'], filters: FILTROS_ARQUIVO[tipo] };
    const result = window
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options);
    const caminho = result.filePaths[0];
    if (result.canceled || !caminho) return null;
    const local = await inspecionarArquivo(caminho);
    const id = randomUUID();
    arquivosEscolhidos.set(id, local);
    return { id, nome: local.nome, tamanho: local.tamanho, tipo: local.tipo?.tipo ?? null };
  },
);

/**
 * Relê os arquivos escolhidos (tamanho e tipo na hora do envio: o arquivo pode ter mudado depois do
 * diálogo), valida e monta o multipart. Erros de validação ou de leitura voltam por campo.
 */
async function prepararEnvioArte(
  entrada: Omit<CadastroEntrada, 'clienteId' | 'pdfId' | 'imagemId'>,
  pdfId: string | undefined,
  imagemId: string | undefined,
): Promise<{ form: FormData } | { erros: ErrosCadastro }> {
  const reler = async (id: string | undefined): Promise<ArquivoLocal | undefined> => {
    if (!id) return undefined;
    const escolhido = arquivosEscolhidos.get(id);
    if (!escolhido) throw new Error('Arquivo não selecionado. Escolha o arquivo de novo.');
    return inspecionarArquivo(escolhido.caminho);
  };
  let arquivos: { pdf?: ArquivoLocal; imagem?: ArquivoLocal };
  try {
    arquivos = { pdf: await reler(pdfId), imagem: await reler(imagemId) };
  } catch (erro) {
    // Erro de disco (ENOENT, EACCES…) tem `code`; "Arquivo não selecionado" sobe como está.
    if (!(erro instanceof Error && 'code' in erro)) throw erro;
    return { erros: { arquivos: 'Não foi possível ler o arquivo escolhido.' } };
  }
  return montarEnvio(entrada, arquivos);
}

ipcMain.handle(
  CHANNELS.artesCadastrar,
  async (_event, input: unknown): Promise<CadastroResultado> => {
    const { clienteId, pdfId, imagemId, ...entrada } = validarCadastro(input);
    const { empresa } = await contexto();
    const envio = await prepararEnvioArte(entrada, pdfId, imagemId);
    if ('erros' in envio) return { ok: false, erros: envio.erros };
    try {
      await artesApi.cadastrar(empresa, clienteId, envio.form);
    } catch (erro) {
      const erros = errosDaRejeicao(erro);
      if (!erros) throw erro;
      return { ok: false, erros };
    }
    arquivosEscolhidos.clear();
    logger.info({ empresa }, 'Arte cadastrada');
    return { ok: true };
  },
);

// Tarefas de arte: os dois perfis usam; a API decide o alcance (o arte finalista só alcança as suas).
ipcMain.handle(CHANNELS.tarefasCriar, async (_event, input: unknown): Promise<Tarefa> => {
  const { clienteId, produtoId } = validarNovaTarefa(input);
  const { empresa } = await contexto();
  const tarefa = await artesApi.criarTarefa(empresa, clienteId, produtoId);
  logger.info({ empresa }, 'Tarefa de arte criada');
  return tarefa;
});

ipcMain.handle(CHANNELS.tarefasListar, async (_event, input: unknown): Promise<Tarefa[]> => {
  const consulta = validarConsultaTarefas(input);
  const { empresa } = await contexto();
  return artesApi.listarTarefas(empresa, consulta);
});

ipcMain.handle(CHANNELS.tarefasContagem, async (): Promise<ContagemTarefas> => {
  const { empresa } = await contexto();
  return artesApi.contagemTarefas(empresa);
});

ipcMain.handle(CHANNELS.tarefasObter, async (_event, input: unknown): Promise<TarefaDetalhe> => {
  const id = validarId(input);
  const { empresa } = await contexto();
  return artesApi.obterTarefa(empresa, id);
});

ipcMain.handle(CHANNELS.tarefasMudarStatus, async (_event, input: unknown): Promise<Tarefa> => {
  const { id, status } = validarMudancaStatus(input);
  const { empresa } = await contexto();
  return artesApi.mudarStatusTarefa(empresa, id, status);
});

ipcMain.handle(
  CHANNELS.tarefasConcluir,
  async (_event, input: unknown): Promise<ConclusaoResultado> => {
    const { tarefaId, pdfId, imagemId, ...entrada } = validarConclusao(input);
    const { empresa } = await contexto();
    const envio = await prepararEnvioArte(entrada, pdfId, imagemId);
    if ('erros' in envio) return { ok: false, erros: envio.erros };
    let tarefa: Tarefa;
    try {
      tarefa = await artesApi.concluirTarefa(empresa, tarefaId, envio.form);
    } catch (erro) {
      const erros = errosDaRejeicao(erro);
      if (!erros) throw erro;
      return { ok: false, erros };
    }
    arquivosEscolhidos.clear();
    logger.info({ empresa }, 'Tarefa de arte concluída');
    return { ok: true, tarefa };
  },
);

ipcMain.handle(
  CHANNELS.tarefasComentar,
  async (_event, input: unknown): Promise<ComentarioTarefa> => {
    const { id, texto, anexoIds } = validarComentario(input);
    const { empresa } = await contexto();
    if (anexoIds.length === 0) return artesApi.comentarTarefa(empresa, id, texto);

    // Relê cada arquivo no envio (tamanho e tipo podem ter mudado depois do diálogo).
    const locais: ArquivoLocal[] = [];
    for (const anexoId of anexoIds) {
      const escolhido = arquivosEscolhidos.get(anexoId);
      if (!escolhido) throw new Error('Arquivo não selecionado. Escolha o arquivo de novo.');
      try {
        locais.push(await inspecionarArquivo(escolhido.caminho));
      } catch {
        throw new Error(`Não foi possível ler ${escolhido.nome}.`);
      }
    }
    const envio = await montarEnvioComentario(texto, locais);
    if ('erro' in envio) throw new Error(envio.erro);
    const comentario = await artesApi.comentarTarefaComAnexos(empresa, id, envio.form);
    for (const anexoId of anexoIds) arquivosEscolhidos.delete(anexoId);
    logger.info({ empresa, anexos: anexoIds.length }, 'Comentário com anexos');
    return comentario;
  },
);

const FILTROS_ANEXO = [
  { name: 'PDF ou imagem', extensions: ['pdf', 'png', 'jpg', 'jpeg', 'webp'] },
];

ipcMain.handle(CHANNELS.tarefasEscolherAnexos, async (event): Promise<ArquivoEscolhido[]> => {
  await contexto();
  const window = BrowserWindow.fromWebContents(event.sender);
  const options: OpenDialogOptions = {
    properties: ['openFile', 'multiSelections'],
    filters: FILTROS_ANEXO,
  };
  const result = window
    ? await dialog.showOpenDialog(window, options)
    : await dialog.showOpenDialog(options);
  if (result.canceled) return [];
  const escolhidos: ArquivoEscolhido[] = [];
  for (const caminho of result.filePaths) {
    const local = await inspecionarArquivo(caminho);
    const id = randomUUID();
    arquivosEscolhidos.set(id, local);
    escolhidos.push({
      id,
      nome: local.nome,
      tamanho: local.tamanho,
      tipo: local.tipo?.tipo ?? null,
    });
  }
  return escolhidos;
});

ipcMain.handle(CHANNELS.tarefasBaixarAnexo, async (event, input: unknown): Promise<boolean> => {
  const { tarefaId, comentarioId, anexoId, nome } = validarAnexoParaBaixar(input);
  const { empresa } = await contexto();
  const window = BrowserWindow.fromWebContents(event.sender);
  // Só o nome do arquivo como sugestão: nada de caminho vindo da API.
  const sugestao =
    [...path.basename(nome)]
      .map((c) => (c.charCodeAt(0) < 0x20 || '<>:"/\\|?*'.includes(c) ? '_' : c))
      .join('') || 'anexo';
  const options = { defaultPath: sugestao };
  const result = window
    ? await dialog.showSaveDialog(window, options)
    : await dialog.showSaveDialog(options);
  if (result.canceled || !result.filePath) return false;
  const conteudo = await artesApi.baixarAnexo(empresa, tarefaId, comentarioId, anexoId);
  await writeFile(result.filePath, conteudo);
  logger.info({ empresa }, 'Anexo de comentário baixado');
  return true;
});

ipcMain.handle(
  CHANNELS.tarefasHistorico,
  async (_event, input: unknown): Promise<EventoTarefa[]> => {
    const id = validarId(input);
    const { empresa } = await contexto();
    return artesApi.historicoTarefa(empresa, id);
  },
);

/** Acompanhamento em curso: um novo clique (ex.: depois de reabrir Configurações) espera o mesmo. */
let sincronizacaoBling: Promise<ResultadoSincronizacaoBling> | undefined;

async function sincronizarBling(
  empresa: string,
  aoProgredir: (progresso: ProgressoBlingTela) => void,
): Promise<ResultadoSincronizacaoBling> {
  try {
    const fim = await acompanharSincronizacao({
      iniciar: () => blingApi.iniciar(empresa),
      estado: () => blingApi.estado(empresa),
      esperar: (ms) => new Promise((resolver) => setTimeout(resolver, ms)),
      aoProgredir: ({ etapa, lidos, total }) => aoProgredir({ etapa, lidos, total }),
    });
    if (fim.situacao === 'falhou') {
      logger.warn({ empresa, codigo: fim.erro.codigo }, 'Sincronização do Bling falhou');
      return { situacao: 'erro', mensagem: fim.erro.mensagem };
    }
    const { produtos, clientes, concluidaEm, avisos } = fim.resumo;
    // Só contagens no log: nada de dados do Bling.
    logger.info(
      { empresa, produtos, clientes, avisos: avisos.length },
      'Sincronização do Bling concluída',
    );
    return { situacao: 'concluida', resumo: { produtos, clientes, concluidaEm, avisos } };
  } catch (erro) {
    if (erro instanceof ErroRequisicao && erro.codigo === 'bling_nao_conectado') {
      const { urlAutorizacao } = await blingApi.conectar(empresa);
      if (!urlAutorizacaoSegura(urlAutorizacao)) {
        logger.error({ empresa }, 'Link de autorização do Bling fora do esperado; nada foi aberto');
        return { situacao: 'erro', mensagem: 'Link de autorização inesperado; nada foi aberto.' };
      }
      await shell.openExternal(urlAutorizacao);
      logger.info({ empresa }, 'Autorização do Bling aberta no navegador');
      return { situacao: 'autorizacao_aberta' };
    }
    if (erro instanceof ErroRequisicao && erro.codigo === 'bling_nao_configurado') {
      return { situacao: 'erro', mensagem: 'Sincronização não configurada no servidor.' };
    }
    logger.error({ empresa, erro: (erro as Error).message }, 'Falha na sincronização do Bling');
    return { situacao: 'erro', mensagem: (erro as Error).message };
  }
}

ipcMain.handle(CHANNELS.blingSincronizar, async (event): Promise<ResultadoSincronizacaoBling> => {
  const empresa = await exigirSincronizacao();
  sincronizacaoBling ??= sincronizarBling(empresa, (progresso) => {
    if (!event.sender.isDestroyed()) event.sender.send(CHANNELS.blingProgresso, progresso);
  }).finally(() => {
    sincronizacaoBling = undefined;
  });
  return sincronizacaoBling;
});

ipcMain.handle(CHANNELS.blingAutomatica, async (): Promise<StatusAutomaticaBling> => {
  const empresa = await exigirSincronizacao();
  try {
    return { situacao: 'ok', status: await blingApi.automatica(empresa) };
  } catch (erro) {
    if (erro instanceof ErroRequisicao && erro.codigo === 'bling_nao_configurado')
      return { situacao: 'erro', mensagem: 'Sincronização não configurada no servidor.' };
    logger.warn(
      { empresa, erro: (erro as Error).message },
      'Falha ao ler o status da sincronização automática do Bling',
    );
    return { situacao: 'erro', mensagem: (erro as Error).message };
  }
});

ipcMain.handle(
  CHANNELS.opClientePorCnpj,
  async (_event, input: unknown): Promise<Cliente | null> => {
    const cnpj = validarCnpj(input);
    const empresa = await exigirOp();
    return artesApi.clientePorCnpj(empresa, cnpj);
  },
);

ipcMain.handle(CHANNELS.opArtesDoItem, async (_event, input: unknown): Promise<ArtesDoItem> => {
  const { clienteId, codigo } = validarItemOp(input);
  const empresa = await exigirOp();
  const resultado = await artesDoItem(artesApi, empresa, clienteId, codigo);
  // Arte recém-cadastrada na tela da OP: a geração só aceita artes que o main conhece.
  op.artes.set(chaveArtes(clienteId, codigo), resultado.artes);
  return resultado;
});

ipcMain.handle(
  CHANNELS.opBuscarPedidos,
  async (_event, input: unknown): Promise<PedidoOpTela[]> => {
    const numeros = validarNumerosOp(input);
    const empresa = await exigirOp();
    if (running) throw new Error('Já existe uma execução em andamento.');
    const mock = mockAtivo();
    // Sem a fixture, o robô entra no Bling: exige as credenciais antes de abrir o navegador.
    const config = await configDoBling(!mock);
    running = true;
    logger.info({ pedidos: numeros.length, mock }, 'Buscando pedidos para a OP');
    try {
      const lidos = mock
        ? await lerPedidosMock(numeros)
        : await lerPedidosBling(config, logger, numeros);
      const telas = await montarPedidosTela(lidos, empresa, artesApi);
      guardarBusca(empresa, lidos, telas);
      return telas;
    } finally {
      running = false;
    }
  },
);

/** Logo da empresa para o cabeçalho da OP; sem logo ou sem conseguir ler, o PDF mostra o nome. */
async function lerLogoDaEmpresa(slug: string): Promise<ImagemOp | undefined> {
  const logo = logoDaEmpresa(slug);
  if (!logo) return undefined;
  try {
    return { bytes: await readFile(path.join(here, logo)), mime: 'image/png' };
  } catch (error) {
    logger.warn({ empresa: slug, err: error }, 'Não consegui ler a logo; a OP sai com o nome');
    return undefined;
  }
}

ipcMain.handle(
  CHANNELS.opGerar,
  async (event, input: unknown, destDir: unknown): Promise<GerarOpResultado> => {
    const selecao = validarItensOp(input);
    const empresa = await exigirOp();
    if (running) throw new Error('Já existe uma execução em andamento.');
    if (op.empresa !== empresa) throw new Error('Busque os pedidos de novo.');
    const itens = selecao.map(itemParaGerar);
    const pasta = await pastaGravavel(destDir);
    const config = await configDoBling(false);
    const estado = sessao.estado();
    const nomeEmpresa =
      estado.situacao === 'deslogado'
        ? empresa
        : rotuloEmpresa(
            estado.perfil.empresas.find((e) => e.slug === empresa)?.nome ?? '',
            empresa,
          );

    const logo = await lerLogoDaEmpresa(empresa);

    running = true;
    logger.info({ itens: itens.length, destDir: pasta }, 'Iniciando geração de OPs');
    try {
      const resultados = await withPaginaOculta(config, (page) =>
        gerarOps({
          itens,
          empresa: nomeEmpresa,
          logo,
          reservarNumeros: (quantidade) => artesApi.reservarNumerosOp(empresa, quantidade),
          baixarImagem: (arteId) => artesApi.imagemDaArte(empresa, arteId),
          salvarPdf: (ordem) => salvarPdfOp(page, ordem, pasta),
          onProgresso: (resultado) => {
            if (resultado.status === 'ok') {
              const { numero, codigo, numeroOp, arquivos } = resultado;
              logger.info({ numero, codigo, numeroOp, arquivos }, 'OP salva');
            }
            event.sender.send(CHANNELS.opProgresso, resultado);
          },
          onFalha: ({ numero, codigo, erro }, error) =>
            logger.error({ numero, codigo, erro, err: error }, 'Falha ao gerar a OP'),
        }),
      );
      return { resultados };
    } finally {
      running = false;
    }
  },
);

ipcMain.handle(CHANNELS.instalarAtualizacao, () => {
  // Não interrompe uma geração em andamento (ex.: NF entre o Salvar e a autorização).
  if (running) throw new Error('Aguarde a execução terminar para atualizar.');
  autoUpdater.quitAndInstall(true, true);
});

/**
 * Procura nova versão nos GitHub Releases (só no app instalado), ao abrir e a cada 4 horas.
 * A versão baixa em segundo plano; a janela oferece reiniciar, e ela também instala ao sair.
 */
function verificarAtualizacoes(window: BrowserWindow) {
  if (!app.isPackaged) return;
  autoUpdater.logger = logger;
  autoUpdater.on('update-downloaded', ({ version }) => {
    logger.info({ version }, 'Atualização baixada');
    if (!window.isDestroyed()) window.webContents.send(CHANNELS.atualizacao, version);
  });
  // O próprio autoUpdater já registra o erro no logger; o listener só evita o erro não tratado.
  autoUpdater.on('error', () => undefined);
  const verificar = () => void autoUpdater.checkForUpdates().catch(() => undefined);
  verificar();
  setInterval(verificar, INTERVALO_ATUALIZACAO_MS).unref();
}

/**
 * Mantém a sessão em dia: renova o acesso e, se o servidor recusar (401) ou voltar a responder,
 * avisa a janela. Sem isso, um usuário desativado só seria deslogado na próxima ação.
 */
function acompanharSessao(window: BrowserWindow) {
  let ultima = '';
  const verificar = async () => {
    await sessao.obterAcesso().catch(() => undefined);
    const atual = await paraTela(sessao.estado());
    if (JSON.stringify(atual) === ultima) return;
    ultima = JSON.stringify(atual);
    if (!window.isDestroyed()) window.webContents.send(CHANNELS.sessaoMudou, atual);
  };
  void paraTela(sessao.estado()).then((atual) => (ultima = JSON.stringify(atual)));
  setInterval(() => void verificar(), INTERVALO_SESSAO_MS).unref();
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1080,
    height: 800,
    minWidth: 820,
    minHeight: 560,
    title: 'Automações',
    icon: iconeAtual,
    backgroundColor: '#f4f5f6',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(here, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
    },
  });
  void window.loadFile(path.join(here, 'index.html'));
  window.webContents.once('did-finish-load', () => {
    verificarAtualizacoes(window);
    acompanharSessao(window);
  });
}

// Uma janela só: duas execuções disputariam o mesmo perfil do Chrome.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const window = BrowserWindow.getAllWindows()[0];
    if (window?.isMinimized()) window.restore();
    window?.focus();
  });
  void app.whenReady().then(createWindow);
}
app.on('window-all-closed', () => app.quit());
