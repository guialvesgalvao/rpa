import 'server-only';

import {
  EsquemaEu,
  EsquemaRespostaEntrar,
  EsquemaTokens,
  type Eu,
  EsquemaErro,
  type RespostaEntrar,
  type Tokens,
  type TrocaSenha,
} from '@plataforma/contratos';
import type { z } from 'zod';

export type Buscar = typeof fetch;

// Recusa da API (4xx) ou falha dela (5xx; 502 quando nem respondeu). O motivo não chega ao usuário.
export type Resultado<T> = { ok: true; dados: T } | { ok: false; status: number };

async function lerResultado<T>(
  resposta: Response | undefined,
  esquema: z.ZodType<T>,
): Promise<Resultado<T>> {
  if (!resposta) return { ok: false, status: 502 };
  if (!resposta.ok) return { ok: false, status: resposta.status };
  return { ok: true, dados: esquema.parse(await resposta.json()) };
}

// `buscar` é injetável para os testes; o padrão é o `fetch` global do momento da chamada.
export function criarApi({ url, buscar = fetch }: { url: string; buscar?: Buscar }) {
  // Atribuir `pathname` normaliza `.`/`..` e nunca troca o host (ao contrário de `new URL('//x', base)`).
  function endereco(caminho: string, busca = ''): URL {
    const destino = new URL(url);
    destino.pathname = caminho;
    destino.search = busca;
    return destino;
  }

  // `undefined` quando a API não respondeu (fora do ar, DNS, conexão recusada).
  async function chamar(caminho: string, init: RequestInit): Promise<Response | undefined> {
    try {
      return await buscar(endereco(caminho), { ...init, cache: 'no-store' });
    } catch (erro) {
      console.error(`API indisponível em ${caminho}:`, erro);
      return undefined;
    }
  }

  const postar = (caminho: string, corpo: unknown) =>
    chamar(caminho, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(corpo),
    });

  return {
    endereco,
    entrar: async (email: string, senha: string): Promise<Resultado<RespostaEntrar>> =>
      lerResultado(
        await postar('/v1/auth/entrar', { email, senha, origem: 'web' }),
        EsquemaRespostaEntrar,
      ),
    renovar: async (renovacao: string): Promise<Resultado<Tokens>> =>
      lerResultado(await postar('/v1/auth/renovar', { renovacao }), EsquemaTokens),
    sair: async (renovacao: string): Promise<boolean> =>
      (await postar('/v1/auth/sair', { renovacao }))?.ok ?? false,
    eu: async (acesso: string): Promise<Resultado<Eu>> =>
      lerResultado(
        await chamar('/v1/eu', { headers: { authorization: `Bearer ${acesso}` } }),
        EsquemaEu,
      ),
    // Troca da própria senha; `codigo` é o da recusa da API (ex.: `senha_atual_incorreta`).
    trocarSenha: async (
      acesso: string,
      corpo: TrocaSenha,
    ): Promise<{ ok: true } | { ok: false; status: number; codigo?: string }> => {
      const resposta = await chamar('/v1/eu/senha', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${acesso}` },
        body: JSON.stringify(corpo),
      });
      if (!resposta) return { ok: false, status: 502 };
      if (resposta.ok) return { ok: true };
      const erro = EsquemaErro.safeParse(await resposta.json().catch(() => null));
      return {
        ok: false,
        status: resposta.status,
        ...(erro.success ? { codigo: erro.data.erro.codigo } : {}),
      };
    },
    repassar: (destino: URL, init: RequestInit) => buscar(destino, init),
  };
}

export type Api = ReturnType<typeof criarApi>;
