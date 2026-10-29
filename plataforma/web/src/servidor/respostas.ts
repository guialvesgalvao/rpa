import type { Erro } from '@plataforma/contratos';
import { NextResponse } from 'next/server';

import type { Cookie } from './sessao';

// Sempre sobre `SITE_URL`: atrás do proxy do Railway, o host da requisição pode ser o interno.
// 303: depois de um POST, o navegador segue com GET.
export function redirecionar(caminho: string, siteUrl: string): NextResponse {
  return NextResponse.redirect(new URL(caminho, siteUrl), 303);
}

export function respostaErro(status: number, codigo: string, mensagem: string): NextResponse {
  return NextResponse.json({ erro: { codigo, mensagem } } satisfies Erro, { status });
}

export function gravarCookies(resposta: NextResponse, cookies: Cookie[]): NextResponse {
  for (const cookie of cookies) resposta.cookies.set(cookie);
  return resposta;
}

// `/entrar`, preservando o erro e o destino (já conferido por `destinoSeguro`).
export function caminhoEntrar({ erro, destino }: { erro?: boolean; destino?: string }): string {
  const busca = new URLSearchParams();
  if (erro) busca.set('erro', '1');
  if (destino) busca.set('destino', destino);
  const texto = busca.toString();
  return texto ? `/entrar?${texto}` : '/entrar';
}
