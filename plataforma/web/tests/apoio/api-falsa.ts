import type { RespostaEntrar, Tokens } from '@plataforma/contratos';
import { UnsecuredJWT } from 'jose';
import { NextRequest } from 'next/server';
import { vi } from 'vitest';

export const API_URL = 'http://api.teste';
export const SITE_URL = 'http://site.teste';

// Token só com `exp` (o site não confere a assinatura).
export function tokenAcesso(expiraEmMs: number): string {
  return new UnsecuredJWT({}).setExpirationTime(Math.floor(expiraEmMs / 1000)).encode();
}

export function tokensFicticios(): Tokens {
  return {
    acesso: tokenAcesso(Date.now() + 15 * 60 * 1000),
    renovacao: 'renovacao-nova',
    expiraEm: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
  };
}

export function respostaEntrar(empresas: string[] = ['aba', 'roma']): RespostaEntrar {
  return {
    ...tokensFicticios(),
    eu: {
      id: '00000000-0000-4000-8000-000000000001',
      nome: 'Pessoa Teste',
      email: 'pessoa@exemplo.com',
      perfil: 'arte_finalista',
      empresas: empresas.map((slug) => ({ slug, nome: slug.toUpperCase() })),
    },
  };
}

type Chamada = { url: URL; init: RequestInit & { duplex?: string } };
type Rota = (chamada: Chamada) => Response | Promise<Response>;

// `fetch` falso: responde pela rota `MÉTODO /caminho` e guarda as chamadas. Rota ausente = 500 (falha o teste).
export function apiFalsa(rotas: Record<string, Rota>) {
  const chamadas: Chamada[] = [];
  const buscar = vi.fn(async (entrada: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(entrada instanceof Request ? entrada.url : entrada);
    const chamada = { url, init };
    chamadas.push(chamada);
    const rota = rotas[`${init.method ?? 'GET'} ${url.pathname}`];
    return rota ? rota(chamada) : new Response('rota não prevista no teste', { status: 500 });
  });
  vi.stubGlobal('fetch', buscar);
  return { buscar, chamadas };
}

export const corpoJson = (chamada: Chamada | undefined): unknown =>
  JSON.parse(String(chamada?.init.body));

export function requisicao(
  caminho: string,
  {
    metodo = 'GET',
    origem,
    cookies = {},
    corpo,
    cabecalhos = {},
  }: {
    metodo?: string;
    origem?: string;
    cookies?: Record<string, string>;
    corpo?: BodyInit;
    cabecalhos?: Record<string, string>;
  } = {},
): NextRequest {
  const headers = new Headers(cabecalhos);
  if (origem) headers.set('origin', origem);
  const cookie = Object.entries(cookies)
    .map(([nome, valor]) => `${nome}=${valor}`)
    .join('; ');
  if (cookie) headers.set('cookie', cookie);
  return new NextRequest(new URL(caminho, SITE_URL), {
    method: metodo,
    headers,
    body: corpo,
    ...(corpo !== undefined && { duplex: 'half' }),
  } as ConstructorParameters<typeof NextRequest>[1]);
}

export function formulario(campos: Record<string, string>): URLSearchParams {
  return new URLSearchParams(campos);
}
