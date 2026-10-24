import type { DocResult } from '../processes/bling/documentos.js';
import type { DocTipo, PedidoSelecao } from '../processes/bling/selecao.js';

export type { DocResult, DocTipo, PedidoSelecao };

export type GerarResultado = { results: DocResult[] };

export type Defaults = {
  destDir: string;
  /** Documentos que já têm gerador; os demais aparecem desabilitados ("em breve"). */
  docsDisponiveis: DocTipo[];
};

/** API exposta pela preload em `window.rpa` (canal seguro entre a janela e o processo principal). */
export type RpaApi = {
  defaults(): Promise<Defaults>;
  escolherPasta(atual: string): Promise<string | null>;
  abrirPasta(dir: string): Promise<void>;
  gerar(selecao: PedidoSelecao[], destDir: string): Promise<GerarResultado>;
  onProgresso(callback: (item: DocResult) => void): void;
};

export const CHANNELS = {
  defaults: 'rpa:defaults',
  escolherPasta: 'rpa:escolher-pasta',
  abrirPasta: 'rpa:abrir-pasta',
  gerar: 'rpa:gerar',
  progresso: 'rpa:progresso',
} as const;
