import { z } from 'zod';

export const BASE_BLING = 'https://api.bling.com.br/Api/v3';
export const LIMITE_PAGINA = 100;
// O Bling aceita 3 req/s por conta; 350 ms entre chamadas deixa folga.
export const INTERVALO_MINIMO_MS = 350;
export const ESPERA_429_MS = 1000;
export const NOVAS_TENTATIVAS_429 = 3;
export const TIMEOUT_MS = 30_000;
// Trava contra paginação que nunca termina (100 mil itens).
export const MAXIMO_PAGINAS = 1000;

// As mensagens destes erros nunca trazem o corpo da resposta, tokens nem dados do Bling.
export class ErroBling extends Error {
  override name = 'ErroBling';
}

export class ErroBlingNaoAutorizado extends ErroBling {
  override name = 'ErroBlingNaoAutorizado';
  constructor() {
    super('O Bling recusou o token de acesso.');
  }
}

export class ErroBlingNaoEncontrado extends ErroBling {
  override name = 'ErroBlingNaoEncontrado';
  constructor() {
    super('Registro não encontrado no Bling.');
  }
}

// `invalid_grant` no `/oauth/token`: código vencido ou refresh token revogado.
export class ErroBlingConcessaoInvalida extends ErroBling {
  override name = 'ErroBlingConcessaoInvalida';
  constructor() {
    super('O Bling recusou a autorização (invalid_grant).');
  }
}

// `tipo`: o `error.type` do Bling (ex.: `TOO_MANY_REQUESTS`) ou um motivo local (`rede`, `resposta_invalida`).
export class ErroBlingIndisponivel extends ErroBling {
  override name = 'ErroBlingIndisponivel';
  constructor(
    readonly tipo: string,
    readonly status?: number,
  ) {
    super(`O Bling não respondeu como esperado (${tipo}${status ? `, HTTP ${status}` : ''}).`);
  }
}

export const EsquemaTokenBling = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1),
  expires_in: z.number().int().positive(),
});
export type TokenBling = z.infer<typeof EsquemaTokenBling>;

export type CredenciaisBling = { clientId: string; clientSecret: string };

// Devolve um access token válido; é chamado antes de cada requisição.
export type AcessoBling = () => Promise<string>;

export type ClienteBling = {
  listarTodas<T>(
    caminho: string,
    parametros: Record<string, string | number>,
    esquemaItem: z.ZodType<T>,
    acesso: AcessoBling,
    aoPaginar?: (lidos: number) => void,
    sinal?: AbortSignal,
  ): Promise<T[]>;
  obter<T>(
    caminho: string,
    esquema: z.ZodType<T>,
    acesso: AcessoBling,
    sinal?: AbortSignal,
  ): Promise<T>;
  token(corpoForm: Record<string, string>, credenciais: CredenciaisBling): Promise<TokenBling>;
};

const TIPO_SEGURO = /^[A-Za-z0-9_]{1,64}$/;

// `error.type` (padrão do Bling) ou `error` (padrão OAuth), só se for um identificador simples.
async function tipoDoErro(resposta: Response): Promise<string | undefined> {
  const corpo: unknown = await resposta.json().catch(() => undefined);
  if (typeof corpo !== 'object' || corpo === null || !('error' in corpo)) return undefined;
  const { error } = corpo;
  const tipo =
    typeof error === 'string'
      ? error
      : typeof error === 'object' && error !== null && 'type' in error
        ? error.type
        : undefined;
  return typeof tipo === 'string' && TIPO_SEGURO.test(tipo) ? tipo : undefined;
}

const esperarPadrao = (ms: number) => new Promise<void>((resolver) => setTimeout(resolver, ms));

// Cliente da API v3 do Bling: só GET nos recursos; o único POST é o `/oauth/token`.
export function criarClienteBling({
  fetch: fetchBling = fetch,
  esperar = esperarPadrao,
  relogio = () => new Date(),
}: {
  fetch?: typeof fetch;
  esperar?: (ms: number) => Promise<void>;
  relogio?: () => Date;
} = {}): ClienteBling {
  let ultimaChamada: number | undefined;

  async function noRitmo(): Promise<void> {
    if (ultimaChamada !== undefined) {
      const falta = ultimaChamada + INTERVALO_MINIMO_MS - relogio().getTime();
      if (falta > 0) await esperar(falta);
    }
    ultimaChamada = relogio().getTime();
  }

  // Respeita o intervalo, repete em 429 e traduz falhas de rede. Devolve a resposta (qualquer status ≠ 429).
  // `sinal` abortado cancela a chamada em andamento (fechamento da API) e lança o motivo do aborto.
  async function chamar(
    url: string,
    init: () => Promise<RequestInit>,
    sinal?: AbortSignal,
  ): Promise<Response> {
    for (let tentativa = 0; ; tentativa++) {
      // Antes do ritmo: o `acesso()` pode fazer um refresh, que também é uma chamada ao Bling.
      const opcoes = await init();
      await noRitmo();
      sinal?.throwIfAborted();
      const tempo = AbortSignal.timeout(TIMEOUT_MS);
      let resposta: Response;
      try {
        resposta = await fetchBling(url, {
          ...opcoes,
          signal: sinal ? AbortSignal.any([tempo, sinal]) : tempo,
        });
      } catch {
        sinal?.throwIfAborted();
        throw new ErroBlingIndisponivel('rede');
      }
      if (resposta.status !== 429) return resposta;
      if (tentativa >= NOVAS_TENTATIVAS_429)
        throw new ErroBlingIndisponivel('TOO_MANY_REQUESTS', 429);
      await esperar(ESPERA_429_MS);
    }
  }

  async function get<T>(
    caminho: string,
    busca: URLSearchParams | undefined,
    esquema: z.ZodType<T>,
    acesso: AcessoBling,
    sinal?: AbortSignal,
  ): Promise<T> {
    const url = `${BASE_BLING}${caminho}${busca ? `?${busca}` : ''}`;
    const resposta = await chamar(
      url,
      async () => ({
        method: 'GET',
        headers: { Authorization: `Bearer ${await acesso()}`, Accept: 'application/json' },
      }),
      sinal,
    );
    if (resposta.status === 401) throw new ErroBlingNaoAutorizado();
    if (resposta.status === 404) throw new ErroBlingNaoEncontrado();
    if (!resposta.ok)
      throw new ErroBlingIndisponivel((await tipoDoErro(resposta)) ?? 'erro_http', resposta.status);
    const corpo: unknown = await resposta.json().catch(() => undefined);
    const lido = z.object({ data: esquema }).safeParse(corpo);
    if (!lido.success) throw new ErroBlingIndisponivel('resposta_invalida', resposta.status);
    return lido.data.data;
  }

  async function listarTodas<T>(
    caminho: string,
    parametros: Record<string, string | number>,
    esquemaItem: z.ZodType<T>,
    acesso: AcessoBling,
    aoPaginar?: (lidos: number) => void,
    sinal?: AbortSignal,
  ): Promise<T[]> {
    const itens: T[] = [];
    for (let pagina = 1; pagina <= MAXIMO_PAGINAS; pagina++) {
      const busca = new URLSearchParams(
        Object.entries({ ...parametros, pagina, limite: LIMITE_PAGINA }).map(([k, v]) => [
          k,
          String(v),
        ]),
      );
      const lote = await get(caminho, busca, z.array(esquemaItem), acesso, sinal);
      itens.push(...lote);
      aoPaginar?.(itens.length);
      if (lote.length < LIMITE_PAGINA) return itens;
    }
    throw new ErroBlingIndisponivel('paginacao_sem_fim');
  }

  return {
    listarTodas,

    obter(caminho, esquema, acesso, sinal) {
      return get(caminho, undefined, esquema, acesso, sinal);
    },

    async token(corpoForm, { clientId, clientSecret }) {
      const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
      const resposta = await chamar(`${BASE_BLING}/oauth/token`, async () => ({
        method: 'POST',
        headers: {
          Authorization: `Basic ${basic}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: '1.0',
          'enable-jwt': '1',
        },
        body: new URLSearchParams(corpoForm).toString(),
      }));
      if (!resposta.ok) {
        const tipo = await tipoDoErro(resposta);
        if (tipo === 'invalid_grant') throw new ErroBlingConcessaoInvalida();
        throw new ErroBlingIndisponivel(tipo ?? 'erro_http', resposta.status);
      }
      const lido = EsquemaTokenBling.safeParse(await resposta.json().catch(() => undefined));
      if (!lido.success) throw new ErroBlingIndisponivel('resposta_invalida', resposta.status);
      return lido.data;
    },
  };
}
