import type { DocResult } from '../processes/bling/documentos.js';
import type { DocTipo, PedidoSelecao } from '../processes/bling/selecao.js';

export type { DocResult, DocTipo, PedidoSelecao };

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
} as const;
