import { constants } from 'node:fs';
import { access } from 'node:fs/promises';
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

import { loadConfig } from '../config/env.js';
import { createLogger } from '../core/logger.js';
import { DOCS_DISPONIVEIS, gerarDocumentos } from '../processes/bling/documentos.js';
import { ensureDir } from '../utils/fs.js';
import {
  CHANNELS,
  type ConfigTela,
  type Defaults,
  type GerarResultado,
  type SessaoTela,
} from './api.js';
import { logoDaEmpresa, podeTrocarEmpresa, rotuloEmpresa } from './empresa.js';
import { criarCliente, ErroIndisponivel, ErroRecusado } from './plataforma/cliente.js';
import { type Perfil, temaDaEmpresa } from './plataforma/contratos.js';
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
import { validarLogin, validarSelecao, validarSlug } from './validacao.js';

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

/** A sessão como a tela vê, com a empresa em uso (a última escolhida, ou a primeira) e o tema dela. */
async function paraTela(estado: EstadoSessao): Promise<SessaoTela> {
  if (estado.situacao === 'deslogado') return estado;
  const { id, nome, email, perfil, empresas } = estado.perfil;
  const slug = empresaAtual(
    await lerSettings(settingsFile),
    id,
    empresas.map((e) => e.slug),
  );
  const atual = empresas.find((e) => e.slug === slug);
  return {
    situacao: estado.situacao,
    nome,
    email,
    perfil,
    empresas,
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
    const { usuarioId, empresa, perfil } = await contexto();
    const settings = await lerSettings(settingsFile);
    if (faltaConfig(perfil, settingsDaEmpresa(settings, usuarioId, empresa))) {
      throw new Error('Preencha o usuário, a senha e a pasta do Bling em Configurações.');
    }
    const config = await montarConfig(envConfig, settings, usuarioId, empresa, dirDados, cifra);
    if (!config.bling.user || !config.bling.password) {
      throw new Error('Preencha o usuário e a senha do Bling em Configurações.');
    }
    // Valida a pasta antes de abrir o navegador (evita gastar um login no Bling à toa).
    const pasta = path.resolve(destDir);
    try {
      await ensureDir(pasta);
      await access(pasta, constants.W_OK);
    } catch {
      throw new Error(`Não foi possível usar a pasta "${pasta}". Escolha outra pasta.`);
    }

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

ipcMain.handle(CHANNELS.sessaoSair, async () => {
  if (running) throw new Error('Aguarde a execução terminar para sair.');
  await sessao.sair();
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
    icon: path.join(here, 'assets', 'logo-aba.png'),
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
