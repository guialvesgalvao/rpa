import { contextBridge, ipcRenderer } from 'electron';

import { CHANNELS, type DocResult, type RpaApi } from './api.js';

const api: RpaApi = {
  defaults: () => ipcRenderer.invoke(CHANNELS.defaults),
  escolherPasta: (atual) => ipcRenderer.invoke(CHANNELS.escolherPasta, atual),
  abrirPasta: (dir) => ipcRenderer.invoke(CHANNELS.abrirPasta, dir),
  gerar: (selecao, destDir) => ipcRenderer.invoke(CHANNELS.gerar, selecao, destDir),
  onProgresso: (callback) =>
    void ipcRenderer.on(CHANNELS.progresso, (_event, item: DocResult) => callback(item)),
  obterConfig: () => ipcRenderer.invoke(CHANNELS.obterConfig),
  salvarConfig: (entrada) => ipcRenderer.invoke(CHANNELS.salvarConfig, entrada),
  onAtualizacao: (callback) =>
    void ipcRenderer.on(CHANNELS.atualizacao, (_event, versao: string) => callback(versao)),
  instalarAtualizacao: () => ipcRenderer.invoke(CHANNELS.instalarAtualizacao),
};

contextBridge.exposeInMainWorld('rpa', api);
