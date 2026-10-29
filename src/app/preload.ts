import { contextBridge, ipcRenderer } from 'electron';

import { CHANNELS, type DocResult, type RpaApi, type SessaoTela } from './api.js';

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
  sessaoEstado: () => ipcRenderer.invoke(CHANNELS.sessaoEstado),
  entrar: (email, senha) => ipcRenderer.invoke(CHANNELS.sessaoEntrar, { email, senha }),
  sair: () => ipcRenderer.invoke(CHANNELS.sessaoSair),
  trocarEmpresa: (slug) => ipcRenderer.invoke(CHANNELS.empresaTrocar, slug),
  onSessaoMudou: (callback) =>
    void ipcRenderer.on(CHANNELS.sessaoMudou, (_event, sessao: SessaoTela) => callback(sessao)),
  artes: {
    listarClientes: (busca, cursor) =>
      ipcRenderer.invoke(CHANNELS.artesListarClientes, { busca, cursor }),
    obterCliente: (id) => ipcRenderer.invoke(CHANNELS.artesObterCliente, id),
    produtosDoCliente: (id) => ipcRenderer.invoke(CHANNELS.artesProdutosDoCliente, id),
    opcoes: () => ipcRenderer.invoke(CHANNELS.artesOpcoes),
    escolherArquivo: (tipo) => ipcRenderer.invoke(CHANNELS.artesEscolherArquivo, tipo),
    cadastrar: (entrada) => ipcRenderer.invoke(CHANNELS.artesCadastrar, entrada),
  },
};

contextBridge.exposeInMainWorld('rpa', api);
