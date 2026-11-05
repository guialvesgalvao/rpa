import { ErroRequisicao } from './artes.js';
import { ErroIndisponivel, ErroRecusado } from './cliente.js';
import {
  type ConexaoBling,
  EsquemaConexaoBling,
  EsquemaErro,
  EsquemaEstadoSincronizacaoBling,
  EsquemaSincronizacaoAutomaticaBling,
  type EstadoSincronizacaoBling,
  type ResumoSincronizacaoBling,
  type SincronizacaoAutomaticaBling,
} from './contratos.js';

export type ClienteBlingApp = {
  /** Link de autorização do Bling (abrir no navegador só depois de `urlAutorizacaoSegura`). */
  conectar(empresa: string): Promise<ConexaoBling>;
  /** Inicia o job (ou devolve o que já está rodando). 409 `bling_nao_conectado` vem como `ErroRequisicao`. */
  iniciar(empresa: string): Promise<EstadoSincronizacaoBling>;
  estado(empresa: string): Promise<EstadoSincronizacaoBling>;
  /** Status da sincronização automática (lido do banco da plataforma; não chama o Bling). */
  automatica(empresa: string): Promise<SincronizacaoAutomaticaBling>;
};

export type DepsClienteBling = {
  baseUrl: string;
  fetch: typeof fetch;
  obterAcesso: () => Promise<string>;
  timeoutMs?: number;
};

const TIMEOUT_PADRAO_MS = 15_000;

type Esquema<T> = { safeParse(dado: unknown): { success: true; data: T } | { success: false } };

/**
 * Mesmo tratamento de `criarClienteArtes`, com uma diferença: os 5xx da sincronização (`bling_nao_configurado`,
 * `bling_indisponivel`) chegam como `ErroRequisicao`, para a tela mostrar a mensagem certa.
 */
export function criarClienteBling({
  baseUrl,
  fetch: buscar,
  obterAcesso,
  timeoutMs = TIMEOUT_PADRAO_MS,
}: DepsClienteBling): ClienteBlingApp {
  const base = baseUrl.replace(/\/+$/, '');

  async function chamar(metodo: 'GET' | 'POST', caminho: string): Promise<Response> {
    const acesso = await obterAcesso();
    let resposta: Response;
    try {
      resposta = await buscar(`${base}${caminho}`, {
        method: metodo,
        headers: { authorization: `Bearer ${acesso}` },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (erro) {
      throw new ErroIndisponivel('Sem conexão com o servidor.', { cause: erro });
    }
    if (resposta.ok) return resposta;

    const status = resposta.status;
    const detalhe = EsquemaErro.safeParse(await resposta.json().catch(() => undefined));
    const doBling = detalhe.success && detalhe.data.erro.codigo.startsWith('bling_');
    if (!doBling && (status >= 500 || status < 400 || status === 408 || status === 429)) {
      throw new ErroIndisponivel(`Servidor indisponível (HTTP ${status}).`);
    }
    const codigo = detalhe.success ? detalhe.data.erro.codigo : 'recusado';
    const mensagem = detalhe.success ? detalhe.data.erro.mensagem : 'Requisição recusada.';
    if (status === 401 || status === 403) throw new ErroRecusado(status, codigo, mensagem);
    throw new ErroRequisicao(status, codigo, mensagem);
  }

  async function lerJson<T>(resposta: Response, esquema: Esquema<T>): Promise<T> {
    const dado: unknown = await resposta.json().catch(() => undefined);
    const resultado = esquema.safeParse(dado);
    if (!resultado.success) throw new ErroIndisponivel('Resposta do servidor fora do contrato.');
    return resultado.data;
  }

  const rota = (empresa: string, resto: string) =>
    `/v1/empresas/${encodeURIComponent(empresa)}/bling${resto}`;

  return {
    async conectar(empresa) {
      return lerJson(await chamar('POST', rota(empresa, '/conexao')), EsquemaConexaoBling);
    },
    async iniciar(empresa) {
      return lerJson(
        await chamar('POST', rota(empresa, '/sincronizacao')),
        EsquemaEstadoSincronizacaoBling,
      );
    },
    async estado(empresa) {
      return lerJson(
        await chamar('GET', rota(empresa, '/sincronizacao')),
        EsquemaEstadoSincronizacaoBling,
      );
    },
    async automatica(empresa) {
      return lerJson(
        await chamar('GET', rota(empresa, '/sincronizacao/automatica')),
        EsquemaSincronizacaoAutomaticaBling,
      );
    },
  };
}

/** Só a página de autorização do Bling: `https:`, host exato e caminho exato. Nada mais vai para o navegador. */
export function urlAutorizacaoSegura(url: string): boolean {
  let lida: URL;
  try {
    lida = new URL(url);
  } catch {
    return false;
  }
  return (
    lida.protocol === 'https:' &&
    lida.hostname === 'www.bling.com.br' &&
    lida.port === '' &&
    lida.username === '' &&
    lida.password === '' &&
    lida.pathname === '/Api/v3/oauth/authorize'
  );
}

export type ProgressoBling = Extract<EstadoSincronizacaoBling, { situacao: 'em_andamento' }>;

export type FimSincronizacao =
  | { situacao: 'concluida'; resumo: ResumoSincronizacaoBling }
  | { situacao: 'falhou'; erro: { codigo: string; mensagem: string } };

export const INTERVALO_ACOMPANHAMENTO_MS = 2000;
export const LIMITE_ACOMPANHAMENTO_MS = 30 * 60 * 1000;

/**
 * Inicia a sincronização e consulta o estado a cada 2 s até `concluida` ou `falhou`. Passado o limite, lança
 * (o job continua no servidor; um novo clique volta a acompanhá-lo).
 */
export async function acompanharSincronizacao({
  iniciar,
  estado,
  esperar,
  aoProgredir = () => {},
  intervaloMs = INTERVALO_ACOMPANHAMENTO_MS,
  limiteMs = LIMITE_ACOMPANHAMENTO_MS,
}: {
  iniciar: () => Promise<EstadoSincronizacaoBling>;
  estado: () => Promise<EstadoSincronizacaoBling>;
  esperar: (ms: number) => Promise<void>;
  aoProgredir?: (progresso: ProgressoBling) => void;
  intervaloMs?: number;
  limiteMs?: number;
}): Promise<FimSincronizacao> {
  let atual = await iniciar();
  for (let decorrido = 0; ; decorrido += intervaloMs) {
    if (atual.situacao === 'concluida' || atual.situacao === 'falhou') return atual;
    // `ociosa` depois de iniciar: a API reiniciou no meio do job.
    if (atual.situacao === 'ociosa')
      return {
        situacao: 'falhou',
        erro: { codigo: 'interrompida', mensagem: 'A sincronização foi interrompida no servidor.' },
      };
    aoProgredir(atual);
    if (decorrido >= limiteMs)
      throw new ErroIndisponivel('A sincronização passou do tempo limite de acompanhamento.');
    await esperar(intervaloMs);
    atual = await estado();
  }
}
