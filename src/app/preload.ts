import { contextBridge, ipcRenderer } from 'electron';

import {
  CHANNELS,
  type DocResult,
  type ProgressoBlingTela,
  type ResultadoOp,
  type RpaApi,
  type SessaoTela,
} from './api.js';

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
  trocarSenha: (senhaAtual, novaSenha) =>
    ipcRenderer.invoke(CHANNELS.senhaTrocar, { senhaAtual, novaSenha }),
  usuarios: {
    listar: () => ipcRenderer.invoke(CHANNELS.usuariosListar),
    criar: (novo) => ipcRenderer.invoke(CHANNELS.usuariosCriar, novo),
    editar: (id, dados) => ipcRenderer.invoke(CHANNELS.usuariosEditar, id, dados),
    definirPermissoes: (id, empresa, permissoes) =>
      ipcRenderer.invoke(CHANNELS.usuariosPermissoes, id, empresa, permissoes),
    excluir: (id) => ipcRenderer.invoke(CHANNELS.usuariosExcluir, id),
  },
  onSessaoMudou: (callback) =>
    void ipcRenderer.on(CHANNELS.sessaoMudou, (_event, sessao: SessaoTela) => callback(sessao)),
  artes: {
    listarClientes: (busca, cursor) =>
      ipcRenderer.invoke(CHANNELS.artesListarClientes, { busca, cursor }),
    obterCliente: (id) => ipcRenderer.invoke(CHANNELS.artesObterCliente, id),
    produtosDoCliente: (id) => ipcRenderer.invoke(CHANNELS.artesProdutosDoCliente, id),
    opcoes: () => ipcRenderer.invoke(CHANNELS.artesOpcoes),
    criarCor: (nome) => ipcRenderer.invoke(CHANNELS.artesCriarCor, nome),
    escolherArquivo: (tipo) => ipcRenderer.invoke(CHANNELS.artesEscolherArquivo, tipo),
    cadastrar: (entrada) => ipcRenderer.invoke(CHANNELS.artesCadastrar, entrada),
  },
  tarefas: {
    criar: (clienteId, produtoId) =>
      ipcRenderer.invoke(CHANNELS.tarefasCriar, { clienteId, produtoId }),
    listar: (consulta) => ipcRenderer.invoke(CHANNELS.tarefasListar, consulta),
    contagem: () => ipcRenderer.invoke(CHANNELS.tarefasContagem),
    responsavelAutomatico: () => ipcRenderer.invoke(CHANNELS.tarefasResponsavelObter),
    definirResponsavelAutomatico: (responsavelId) =>
      ipcRenderer.invoke(CHANNELS.tarefasResponsavelDefinir, responsavelId),
    obter: (id) => ipcRenderer.invoke(CHANNELS.tarefasObter, id),
    mudarStatus: (id, status) => ipcRenderer.invoke(CHANNELS.tarefasMudarStatus, { id, status }),
    concluir: (entrada) => ipcRenderer.invoke(CHANNELS.tarefasConcluir, entrada),
    comentar: (id, texto, anexoIds) =>
      ipcRenderer.invoke(CHANNELS.tarefasComentar, { id, texto, anexoIds }),
    escolherAnexos: () => ipcRenderer.invoke(CHANNELS.tarefasEscolherAnexos),
    baixarAnexo: (anexo) => ipcRenderer.invoke(CHANNELS.tarefasBaixarAnexo, anexo),
    historico: (id) => ipcRenderer.invoke(CHANNELS.tarefasHistorico, id),
  },
  op: {
    clientePorCnpj: (cnpj) => ipcRenderer.invoke(CHANNELS.opClientePorCnpj, cnpj),
    artesDoItem: (clienteId, codigo) =>
      ipcRenderer.invoke(CHANNELS.opArtesDoItem, { clienteId, codigo }),
    buscarPedidos: (numeros) => ipcRenderer.invoke(CHANNELS.opBuscarPedidos, numeros),
    gerar: (itens, destDir) => ipcRenderer.invoke(CHANNELS.opGerar, itens, destDir),
    onProgresso: (callback) =>
      void ipcRenderer.on(CHANNELS.opProgresso, (_event, resultado: ResultadoOp) =>
        callback(resultado),
      ),
  },
  bling: {
    sincronizar: () => ipcRenderer.invoke(CHANNELS.blingSincronizar),
    onProgresso: (callback) =>
      void ipcRenderer.on(CHANNELS.blingProgresso, (_event, progresso: ProgressoBlingTela) =>
        callback(progresso),
      ),
    automatica: () => ipcRenderer.invoke(CHANNELS.blingAutomatica),
  },
};

contextBridge.exposeInMainWorld('rpa', api);
