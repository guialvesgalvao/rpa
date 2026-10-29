import type { Eu, Tokens } from '@plataforma/contratos';
import { decodeJwt } from 'jose';

import { ordenarEmpresas } from '../empresas';

export const COOKIE_ACESSO = 'rpa_acesso';
export const COOKIE_RENOVACAO = 'rpa_renovacao';
export const COOKIE_EMPRESA = 'rpa_empresa';

const DURACAO_ACESSO_S = 15 * 60;
const DURACAO_RENOVACAO_S = 30 * 24 * 60 * 60;
const DURACAO_EMPRESA_S = 365 * 24 * 60 * 60;
// Renova um pouco antes do fim: o token não pode vencer entre o site e a API.
const MARGEM_RENOVACAO_MS = 30_000;

// Os prefixos da API que o proxy `/api/v1/**` repassa; `/v1/auth/**` fica de fora (só pelas rotas de sessão).
const PREFIXOS_PERMITIDOS = ['/v1/eu', '/v1/empresas/', '/v1/cores', '/v1/maquinas'];

const BASE_LOCAL = 'http://local.invalid';

export type Cookie = {
  name: string;
  value: string;
  httpOnly: true;
  secure: boolean;
  sameSite: 'lax';
  path: '/';
  maxAge: number;
};

const emProducao = () => process.env.NODE_ENV === 'production';

const cookie = (name: string, value: string, maxAge: number, secure: boolean): Cookie => ({
  name,
  value,
  httpOnly: true,
  secure,
  sameSite: 'lax',
  path: '/',
  maxAge,
});

// O site não tem o segredo do JWT: lê só o `exp`, sem validar a assinatura. Quem valida é a API.
export function precisaRenovar(acesso: string | undefined, agora: Date): boolean {
  if (!acesso) return true;
  try {
    const { exp } = decodeJwt(acesso);
    return typeof exp !== 'number' || exp * 1000 - MARGEM_RENOVACAO_MS <= agora.getTime();
  } catch {
    return true;
  }
}

export function montarCookies(tokens: Tokens, seguro = emProducao()): Cookie[] {
  return [
    cookie(COOKIE_ACESSO, tokens.acesso, DURACAO_ACESSO_S, seguro),
    cookie(COOKIE_RENOVACAO, tokens.renovacao, DURACAO_RENOVACAO_S, seguro),
  ];
}

// `rpa_empresa` fica: é preferência do navegador, conferida contra as empresas de quem entrar.
export function cookiesApagados(seguro = emProducao()): Cookie[] {
  return [cookie(COOKIE_ACESSO, '', 0, seguro), cookie(COOKIE_RENOVACAO, '', 0, seguro)];
}

// Proteção contra CSRF nos métodos que alteram estado: o navegador sempre envia `Origin` neles.
export function origemPermitida(req: Request, siteUrl: string): boolean {
  const origem = req.headers.get('origin');
  return origem !== null && origem === new URL(siteUrl).origin;
}

// Recebe o caminho já normalizado pelo `URL` (sem `.`/`..`). Barras e pontos codificados ficam de fora:
// a API poderia decodificá-los e sair do prefixo conferido aqui.
export function caminhoPermitido(caminho: string): boolean {
  if (/%2e|%2f|%5c|\\/i.test(caminho)) return false;
  if (caminho.split('/').some((segmento) => segmento === '.' || segmento === '..')) return false;
  return PREFIXOS_PERMITIDOS.some((prefixo) =>
    prefixo.endsWith('/')
      ? caminho.length > prefixo.length && caminho.startsWith(prefixo)
      : caminho === prefixo || caminho.startsWith(`${prefixo}/`),
  );
}

const temControle = (texto: string) =>
  [...texto].some((caractere) => {
    const codigo = caractere.charCodeAt(0);
    return codigo < 0x20 || codigo === 0x7f;
  });

// Só caminhos do próprio site, para não virar redirecionamento aberto (`//host` e `/\host` levam a outro
// domínio no navegador). Devolve o caminho normalizado ou `undefined`.
export function destinoSeguro(destino: unknown): string | undefined {
  if (typeof destino !== 'string' || destino.length > 2048 || temControle(destino)) return;
  if (!destino.startsWith('/') || destino.startsWith('//') || destino.includes('\\')) return;

  const url = new URL(destino, BASE_LOCAL);
  if (url.origin !== BASE_LOCAL || url.pathname.startsWith('//')) return;
  if (url.pathname === '/entrar' || /^\/(api|_next)(\/|$)/.test(url.pathname)) return;
  return url.pathname + url.search;
}

// A empresa do cookie, se o usuário ainda tiver acesso a ela; senão, a primeira da lista do seletor.
export function empresaInicial(
  eu: Pick<Eu, 'empresas'>,
  cookie: string | undefined,
): string | undefined {
  const slugs = ordenarEmpresas(eu.empresas).map((empresa) => empresa.slug);
  return cookie !== undefined && slugs.includes(cookie) ? cookie : slugs[0];
}

// Preferência do navegador, não credencial: o seletor grava e o login confere com `empresaInicial`.
export function cookieEmpresa(slug: string, seguro = emProducao()): Cookie {
  return cookie(COOKIE_EMPRESA, slug, DURACAO_EMPRESA_S, seguro);
}
