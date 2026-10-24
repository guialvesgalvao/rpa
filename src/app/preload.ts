import { contextBridge, ipcRenderer } from 'electron';

import { CHANNELS, type DocResult, type RpaApi } from './api.js';

const api: RpaApi = {
  defaults: () => ipcRenderer.invoke(CHANNELS.defaults),
  escolherPasta: (atual) => ipcRenderer.invoke(CHANNELS.escolherPasta, atual),
  abrirPasta: (dir) => ipcRenderer.invoke(CHANNELS.abrirPasta, dir),
  gerar: (selecao, destDir) => ipcRenderer.invoke(CHANNELS.gerar, selecao, destDir),
  onProgresso: (callback) =>
    void ipcRenderer.on(CHANNELS.progresso, (_event, item: DocResult) => callback(item)),
};

contextBridge.exposeInMainWorld('rpa', api);
