import { constants } from 'node:fs';
import { access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow, dialog, ipcMain, shell, type OpenDialogOptions } from 'electron';

import { loadConfig } from '../config/env.js';
import { createLogger } from '../core/logger.js';
import { DOCS_DISPONIVEIS, gerarDocumentos } from '../processes/bling/documentos.js';
import { ensureDir } from '../utils/fs.js';
import { CHANNELS, type Defaults, type GerarResultado } from './api.js';
import { validarSelecao } from './validacao.js';

// Compilado em dist/app/; os caminhos do .env (data/, logs/...) são relativos à raiz do projeto,
// que é o diretório de trabalho quando iniciado por `npm run app`.
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');

const config = loadConfig();
const logger = createLogger('bling-app', config.logLevel, config.logsDir);
let running = false;

ipcMain.handle(CHANNELS.defaults, (): Defaults => ({
  destDir: config.bling.boletosDir,
  docsDisponiveis: DOCS_DISPONIVEIS,
}));

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

function createWindow() {
  const window = new BrowserWindow({
    width: 860,
    height: 800,
    minWidth: 620,
    minHeight: 560,
    title: 'ABA Embalagens — Documentos',
    icon: path.join(root, 'src', 'app', 'assets', 'logo-aba.png'),
    backgroundColor: '#f4f5f6',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(here, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
    },
  });
  void window.loadFile(path.join(root, 'src', 'app', 'index.html'));
}

void app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
