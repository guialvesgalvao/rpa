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
import { CHANNELS, type ConfigTela, type Defaults, type GerarResultado } from './api.js';
import {
  aplicarSettings,
  atualizarSettings,
  type Cifra,
  lerSettings,
  paraTela,
  salvarSettings,
} from './settings.js';
import { validarSelecao } from './validacao.js';

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

// Configurações da tela (usuário/senha do Bling, pastas); valem sobre o .env.
const settingsFile = path.join(baseDir, 'data', 'settings.json');
const cifra: Cifra = {
  disponivel: () => safeStorage.isEncryptionAvailable(),
  cifrar: (texto) => safeStorage.encryptString(texto).toString('base64'),
  decifrar: (cifrado) => safeStorage.decryptString(Buffer.from(cifrado, 'base64')),
};
const configAtual = async () => aplicarSettings(envConfig, await lerSettings(settingsFile), cifra);

const { autoUpdater } = electronUpdater;
const INTERVALO_ATUALIZACAO_MS = 4 * 60 * 60 * 1000;

ipcMain.handle(CHANNELS.defaults, async (): Promise<Defaults> => ({
  destDir: (await configAtual()).bling.boletosDir,
  docsDisponiveis: DOCS_DISPONIVEIS,
  versao: app.getVersion(),
}));

ipcMain.handle(CHANNELS.obterConfig, async (): Promise<ConfigTela> =>
  paraTela(envConfig, await lerSettings(settingsFile), cifra),
);

ipcMain.handle(CHANNELS.salvarConfig, async (_event, input: unknown): Promise<ConfigTela> => {
  if (running) throw new Error('Aguarde a execução terminar para alterar as configurações.');
  const settings = atualizarSettings(await lerSettings(settingsFile), input, cifra);
  await salvarSettings(settingsFile, settings);
  logger.info({ blingUser: settings.blingUser }, 'Configurações salvas');
  return paraTela(envConfig, settings, cifra);
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
    if (running) throw new Error('Já existe uma execução em andamento.');
    if (typeof destDir !== 'string' || !destDir.trim()) {
      throw new Error('Escolha a pasta de destino.');
    }
    const selecao = validarSelecao(input);
    const config = await configAtual();
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

function createWindow() {
  const window = new BrowserWindow({
    width: 1080,
    height: 800,
    minWidth: 820,
    minHeight: 560,
    title: 'ABA Embalagens — Automações',
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
  window.webContents.once('did-finish-load', () => verificarAtualizacoes(window));
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
