import type { DocResult } from '../processes/bling/documentos.js';
import type { DocTipo, PedidoSelecao } from '../processes/bling/selecao.js';
import type { ResultadoOp } from '../processes/op/gerar.js';
import type { PreenchimentoOp } from '../processes/op/preenchimento.js';

import type {
  ArtesDoItem,
  ConsultaTarefasApp,
  ErrosCadastro,
  OpcoesArte,
} from './plataforma/artes.js';
import type { ItemOpTela, PedidoOpTela } from './plataforma/op.js';
import type {
  Cliente,
  ComentarioTarefa,
  ContagemTarefas,
  EventoTarefa,
  Opcao,
  PaginaClientes,
  Area,
  ProdutoDoCliente,
  ResponsavelAutomatico,
  SincronizacaoAutomaticaBling,
  StatusTarefa,
  Tarefa,
  TarefaDetalhe,
  Tema,
  TipoArquivo,
  UsuarioDetalhe,
} from './plataforma/contratos.js';

export type { DocResult, DocTipo, PedidoSelecao };

export type EmpresaTela = { slug: string; nome: string };

/** Empresa do usuário da sessão, com as permissões dele nela (catálogo do `contratos`). */
export type EmpresaSessaoTela = EmpresaTela & { permissoes: string[] };

/** Empresa em uso, com a identidade visual que a tela aplica. */
export type EmpresaAtualTela = EmpresaTela & { tema: Tema; logo?: string };

/**
 * Sessão como a tela vê: sem tokens. `offline` usa o perfil em cache (servidor sem resposta).
 * `empresa` falta só se o usuário não tem empresa vinculada.
 */
export type SessaoTela =
  | { situacao: 'deslogado' }
  | {
      situacao: 'online' | 'offline';
      nome: string;
      email: string;
      /** Permissões do usuário na empresa em uso (catálogo do `contratos`); decidem abas e blocos da tela. */
      permissoes: string[];
      empresas: EmpresaSessaoTela[];
      empresa?: EmpresaAtualTela;
      /** Senha inicial definida pelo admin: a tela pede a troca antes de mostrar o app. */
      deveTrocarSenha: boolean;
    };

/** Novo usuário pela aba Usuários; `permissoes` por slug de empresa, só de quem pode editá-las. */
export type NovoUsuarioTela = {
  nome: string;
  email: string;
  area: Area | null;
  empresas: string[];
  senha: string;
  permissoes: Record<string, string[]>;
};

/** Dados do usuário que a edição muda (as permissões ficam em `definirPermissoes`). */
export type EdicaoUsuarioTela = {
  nome: string;
  email: string;
  area: Area | null;
  empresas: string[];
};

/**
 * Aba Usuários, na empresa em uso: lista, cria, edita, define as permissões por empresa e exclui. A API confere
 * as permissões de quem pede; a recusa vem como mensagem pronta.
 */
export type UsuariosApi = {
  listar(): Promise<UsuarioDetalhe[]>;
  criar(novo: NovoUsuarioTela): Promise<UsuarioDetalhe>;
  editar(id: string, dados: EdicaoUsuarioTela): Promise<UsuarioDetalhe>;
  /** `empresa`: a empresa em que as permissões valem (uma das do usuário). */
  definirPermissoes(id: string, empresa: string, permissoes: string[]): Promise<UsuarioDetalhe>;
  excluir(id: string): Promise<void>;
};

/** Arquivo escolhido no diálogo: caminho e conteúdo ficam no main; `id` o identifica no cadastro. */
export type ArquivoEscolhido = {
  id: string;
  nome: string;
  tamanho: number;
  tipo: TipoArquivo | null;
};

/** Dados do formulário de nova arte; os arquivos vão pelos ids de `escolherArquivo`. */
export type CadastroArte = {
  clienteId: string;
  produtoId: string;
  nome: string;
  corId: string;
  maquinaIds: string[];
  pdfId?: string;
  imagemId?: string;
};

export type CadastroResultado = { ok: true } | { ok: false; erros: ErrosCadastro };

/** Conclusão de tarefa: os dados da arte (cliente e produto são os da tarefa). */
export type ConclusaoTarefa = Omit<CadastroArte, 'clienteId'> & { tarefaId: string };

export type ConclusaoResultado = { ok: true; tarefa: Tarefa } | { ok: false; erros: ErrosCadastro };

export type { ConsultaTarefasApp };

/**
 * Tarefas de desenvolvimento de arte da empresa em uso. A API decide o alcance: o arte finalista só
 * vê e muda as próprias. Falha de rede ou de permissão vem como mensagem pronta para a tela.
 */
export type TarefasApi = {
  criar(clienteId: string, produtoId: string): Promise<Tarefa>;
  listar(consulta: ConsultaTarefasApp): Promise<Tarefa[]>;
  /** Contadores dos atalhos da home de Artes (não terminadas, por status). */
  contagem(): Promise<ContagemTarefas>;
  /** Responsável pelas tarefas automáticas da empresa em uso (só admin). */
  responsavelAutomatico(): Promise<ResponsavelAutomatico>;
  definirResponsavelAutomatico(responsavelId: string | null): Promise<ResponsavelAutomatico>;
  obter(id: string): Promise<TarefaDetalhe>;
  mudarStatus(id: string, status: StatusTarefa): Promise<Tarefa>;
  /** Cadastra a arte e conclui; erros de validação voltam por campo, como no cadastro. */
  concluir(entrada: ConclusaoTarefa): Promise<ConclusaoResultado>;
  /** Texto ou anexos (ids de `escolherAnexos`); a validação dos arquivos é refeita no envio. */
  comentar(id: string, texto: string, anexoIds?: string[]): Promise<ComentarioTarefa>;
  historico(id: string): Promise<EventoTarefa[]>;
  /** Diálogo de arquivos (PDF e imagens, vários); a janela só conhece os ids. */
  escolherAnexos(): Promise<ArquivoEscolhido[]>;
  /** Pede o destino e grava o anexo; `false` se o usuário cancelou. */
  baixarAnexo(anexo: AnexoParaBaixar): Promise<boolean>;
};

export type AnexoParaBaixar = {
  tarefaId: string;
  comentarioId: string;
  anexoId: string;
  nome: string;
};

/** Artes da empresa em uso. Falha de rede ou de permissão vem como mensagem pronta para a tela. */
export type ArtesApi = {
  listarClientes(busca: string, cursor: string | null): Promise<PaginaClientes>;
  obterCliente(id: string): Promise<Cliente>;
  produtosDoCliente(id: string): Promise<ProdutoDoCliente[]>;
  opcoes(): Promise<OpcoesArte>;
  /** Cria a cor (só o nome) e a devolve; a mensagem do erro vai pronta para a tela. */
  criarCor(nome: string): Promise<Opcao>;
  /** `null` se o usuário cancelar o diálogo. */
  escolherArquivo(tipo: TipoArquivo): Promise<ArquivoEscolhido | null>;
  cadastrar(entrada: CadastroArte): Promise<CadastroResultado>;
};

export type { ArtesDoItem, ItemOpTela, PedidoOpTela, ResultadoOp };

export type { PreenchimentoOp };

/**
 * Produto marcado para gerar a OP; `arteId` vazio gera a OP sem o bloco de arte. `preenchimento`
 * ausente gera a OP com data de entrega, processo e observação em branco.
 */
export type ItemParaGerarOp = {
  numero: string;
  indice: number;
  arteId?: string;
  preenchimento?: PreenchimentoOp;
};

export type GerarOpResultado = { resultados: ResultadoOp[] };

/**
 * Ordens de Produção: só para o admin da Roma (o main recusa os demais com "Sem permissão.").
 * Falha de rede ou de permissão vem como mensagem pronta para a tela.
 */
export type OpApi = {
  /** Cliente do banco com esse CNPJ (com ou sem máscara); `null` se não houver. */
  clientePorCnpj(cnpj: string): Promise<Cliente | null>;
  /** Produto do cliente com o código (SKU) do item e as artes dele, da mais nova para a mais antiga. */
  artesDoItem(clienteId: string, codigo: string): Promise<ArtesDoItem>;
  /** Lê os pedidos (Bling, ou a fixture com `RPA_OP_MOCK=1`) e acha clientes e artes no banco. */
  buscarPedidos(numeros: string[]): Promise<PedidoOpTela[]>;
  /** Gera um PDF por item, com os pedidos da última busca. */
  gerar(itens: ItemParaGerarOp[], destDir: string): Promise<GerarOpResultado>;
  onProgresso(callback: (resultado: ResultadoOp) => void): void;
};

export type GerarResultado = { results: DocResult[] };

export type Defaults = {
  destDir: string;
  /** Documentos que já têm gerador; os demais aparecem desabilitados ("em breve"). */
  docsDisponiveis: DocTipo[];
  /** Versão do app (package.json). */
  versao: string;
};

/** Configurações como a tela mostra; a senha nunca sai do processo principal. */
export type ConfigTela = {
  blingUser: string;
  temSenha: boolean;
  destDir: string;
  /** Caminho definido na tela; vazio usa `chromePadrao`. */
  chromePath: string;
  chromePadrao: string;
  /** Falta usuário, senha ou pasta desta empresa: a tela abre as Configurações. */
  falta: boolean;
};

/** O que a tela de Configurações envia. Senha vazia mantém a atual. */
export type ConfigEntrada = {
  blingUser: string;
  blingPassword?: string;
  destDir: string;
  chromePath?: string;
};

/** API exposta pela preload em `window.rpa` (canal seguro entre a janela e o processo principal). */
export type RpaApi = {
  defaults(): Promise<Defaults>;
  escolherPasta(atual: string): Promise<string | null>;
  abrirPasta(dir: string): Promise<void>;
  gerar(selecao: PedidoSelecao[], destDir: string): Promise<GerarResultado>;
  onProgresso(callback: (item: DocResult) => void): void;
  obterConfig(): Promise<ConfigTela>;
  salvarConfig(entrada: ConfigEntrada): Promise<ConfigTela>;
  /** Avisa quando uma nova versão terminou de baixar. */
  onAtualizacao(callback: (versao: string) => void): void;
  /** Fecha o app e instala a versão baixada. */
  instalarAtualizacao(): Promise<void>;
  sessaoEstado(): Promise<SessaoTela>;
  /** Erro de credenciais ou de rede vem como mensagem pronta para a tela. */
  entrar(email: string, senha: string): Promise<SessaoTela>;
  sair(): Promise<void>;
  /** Troca a empresa em uso; recusada durante uma execução ou para empresa fora do perfil. */
  trocarEmpresa(slug: string): Promise<SessaoTela>;
  /** Avisa quando a sessão muda sem ação da tela (renovação recusada ou servidor fora do ar). */
  onSessaoMudou(callback: (sessao: SessaoTela) => void): void;
  /** Troca a própria senha; esta sessão continua, as outras caem. */
  trocarSenha(senhaAtual: string, novaSenha: string): Promise<SessaoTela>;
  usuarios: UsuariosApi;
  artes: ArtesApi;
  tarefas: TarefasApi;
  op: OpApi;
  bling: BlingApi;
};

/** Progresso do job de sincronização, para o texto de status. */
export type ProgressoBlingTela = {
  etapa: 'produtos' | 'clientes' | 'detalhes';
  lidos: number;
  total: number | null;
};

/** Resumo da sincronização concluída (só contagens: os dados ficam no servidor). */
export type ResumoBlingTela = {
  produtos: number;
  clientes: number;
  concluidaEm: string;
  avisos: string[];
};

export type ResultadoSincronizacaoBling =
  | { situacao: 'concluida'; resumo: ResumoBlingTela }
  /** A empresa não estava conectada: o main abriu a autorização do Bling no navegador. */
  | { situacao: 'autorizacao_aberta' }
  | { situacao: 'erro'; mensagem: string };

/** Status da sincronização automática no servidor, ou o erro ao lê-lo. */
export type StatusAutomaticaBling =
  { situacao: 'ok'; status: SincronizacaoAutomaticaBling } | { situacao: 'erro'; mensagem: string };

export type BlingApi = {
  /** Sincroniza produtos e clientes do Bling (só admin da Roma); resolve no fim do job. */
  sincronizar(): Promise<ResultadoSincronizacaoBling>;
  onProgresso(callback: (progresso: ProgressoBlingTela) => void): void;
  /** Se a sincronização automática está ligada no servidor e o último resultado (só admin da Roma). */
  automatica(): Promise<StatusAutomaticaBling>;
};

export const CHANNELS = {
  defaults: 'rpa:defaults',
  escolherPasta: 'rpa:escolher-pasta',
  abrirPasta: 'rpa:abrir-pasta',
  gerar: 'rpa:gerar',
  progresso: 'rpa:progresso',
  obterConfig: 'rpa:obter-config',
  salvarConfig: 'rpa:salvar-config',
  atualizacao: 'rpa:atualizacao',
  instalarAtualizacao: 'rpa:instalar-atualizacao',
  sessaoEstado: 'rpa:sessao:estado',
  sessaoEntrar: 'rpa:sessao:entrar',
  sessaoSair: 'rpa:sessao:sair',
  sessaoMudou: 'rpa:sessao:mudou',
  empresaTrocar: 'rpa:empresa:trocar',
  senhaTrocar: 'rpa:senha:trocar',
  usuariosListar: 'rpa:usuarios:listar',
  usuariosCriar: 'rpa:usuarios:criar',
  usuariosEditar: 'rpa:usuarios:editar',
  usuariosPermissoes: 'rpa:usuarios:permissoes',
  usuariosExcluir: 'rpa:usuarios:excluir',
  artesListarClientes: 'rpa:artes:listar-clientes',
  artesObterCliente: 'rpa:artes:obter-cliente',
  artesProdutosDoCliente: 'rpa:artes:produtos-do-cliente',
  artesOpcoes: 'rpa:artes:opcoes',
  artesCriarCor: 'rpa:artes:criar-cor',
  artesEscolherArquivo: 'rpa:artes:escolher-arquivo',
  artesCadastrar: 'rpa:artes:cadastrar',
  tarefasCriar: 'rpa:tarefas:criar',
  tarefasListar: 'rpa:tarefas:listar',
  tarefasContagem: 'rpa:tarefas:contagem',
  tarefasResponsavelObter: 'rpa:tarefas:responsavel-obter',
  tarefasResponsavelDefinir: 'rpa:tarefas:responsavel-definir',
  tarefasObter: 'rpa:tarefas:obter',
  tarefasMudarStatus: 'rpa:tarefas:mudar-status',
  tarefasConcluir: 'rpa:tarefas:concluir',
  tarefasComentar: 'rpa:tarefas:comentar',
  tarefasEscolherAnexos: 'rpa:tarefas:escolher-anexos',
  tarefasBaixarAnexo: 'rpa:tarefas:baixar-anexo',
  tarefasHistorico: 'rpa:tarefas:historico',
  opClientePorCnpj: 'rpa:op:cliente-por-cnpj',
  opArtesDoItem: 'rpa:op:artes-do-item',
  opBuscarPedidos: 'rpa:op:buscar-pedidos',
  opGerar: 'rpa:op:gerar',
  opProgresso: 'rpa:op:progresso',
  blingSincronizar: 'rpa:bling:sincronizar',
  blingProgresso: 'rpa:bling:progresso',
  blingAutomatica: 'rpa:bling:automatica',
} as const;
