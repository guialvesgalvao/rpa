import {
  EsquemaErro,
  EsquemaEu,
  EsquemaRespostaEntrar,
  EsquemaTokens,
  type Eu,
  type RespostaEntrar,
  type Tokens,
} from './contratos.js';

/** Rede caída, timeout, 5xx ou resposta fora do contrato: o servidor não respondeu de forma utilizável. */
export class ErroIndisponivel extends Error {
  override name = 'ErroIndisponivel';
}

/** 401/403: a API recusou as credenciais, o token de renovação ou o token de acesso. */
export class ErroRecusado extends Error {
  override name = 'ErroRecusado';

  constructor(
    readonly status: number,
    readonly codigo: string,
    mensagem: string,
  ) {
    super(mensagem);
  }
}

export type ClientePlataforma = {
  entrar(email: string, senha: string): Promise<RespostaEntrar>;
  renovar(renovacao: string): Promise<Tokens>;
  sair(renovacao: string): Promise<void>;
  eu(acesso: string): Promise<Eu>;
};

export type DepsCliente = {
  baseUrl: string;
  fetch: typeof fetch;
  /** Tempo máximo de cada chamada, em ms. */
  timeoutMs?: number;
};

const TIMEOUT_PADRAO_MS = 15_000;

type Esquema<T> = { safeParse(dado: unknown): { success: true; data: T } | { success: false } };

export function criarCliente({
  baseUrl,
  fetch: buscar,
  timeoutMs = TIMEOUT_PADRAO_MS,
}: DepsCliente): ClientePlataforma {
  const base = baseUrl.replace(/\/+$/, '');

  async function chamar(
    metodo: 'GET' | 'POST',
    caminho: string,
    opcoes: { corpo?: unknown; acesso?: string } = {},
  ): Promise<Response> {
    const headers: Record<string, string> = {};
    if (opcoes.corpo !== undefined) headers['content-type'] = 'application/json';
    if (opcoes.acesso) headers.authorization = `Bearer ${opcoes.acesso}`;

    let resposta: Response;
    try {
      resposta = await buscar(`${base}${caminho}`, {
        method: metodo,
        headers,
        body: opcoes.corpo === undefined ? undefined : JSON.stringify(opcoes.corpo),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (erro) {
      throw new ErroIndisponivel('Sem conexão com o servidor.', { cause: erro });
    }

    if (resposta.ok) return resposta;
    if (resposta.status === 401 || resposta.status === 403) {
      const detalhe = EsquemaErro.safeParse(await resposta.json().catch(() => undefined));
      throw new ErroRecusado(
        resposta.status,
        detalhe.success ? detalhe.data.erro.codigo : 'recusado',
        detalhe.success ? detalhe.data.erro.mensagem : 'Acesso recusado.',
      );
    }
    throw new ErroIndisponivel(`Servidor indisponível (HTTP ${resposta.status}).`);
  }

  async function lerJson<T>(resposta: Response, esquema: Esquema<T>): Promise<T> {
    const dado: unknown = await resposta.json().catch(() => undefined);
    const resultado = esquema.safeParse(dado);
    if (!resultado.success) throw new ErroIndisponivel('Resposta do servidor fora do contrato.');
    return resultado.data;
  }

  return {
    async entrar(email, senha) {
      const resposta = await chamar('POST', '/v1/auth/entrar', {
        corpo: { email, senha, origem: 'desktop' },
      });
      return lerJson(resposta, EsquemaRespostaEntrar);
    },
    async renovar(renovacao) {
      const resposta = await chamar('POST', '/v1/auth/renovar', { corpo: { renovacao } });
      return lerJson(resposta, EsquemaTokens);
    },
    async sair(renovacao) {
      await chamar('POST', '/v1/auth/sair', { corpo: { renovacao } });
    },
    async eu(acesso) {
      const resposta = await chamar('GET', '/v1/eu', { acesso });
      return lerJson(resposta, EsquemaEu);
    },
  };
}
