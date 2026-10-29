import type { DocResult } from '../processes/bling/documentos.js';
import type { DocTipo, PedidoSelecao } from '../processes/bling/selecao.js';

import type { Perfil, Tema } from './plataforma/contratos.js';

export type { DocResult, DocTipo, PedidoSelecao };

export type EmpresaTela = { slug: string; nome: string };

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
      perfil: Perfil;
      empresas: EmpresaTela[];
      empresa?: EmpresaAtualTela;
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
} as const;
