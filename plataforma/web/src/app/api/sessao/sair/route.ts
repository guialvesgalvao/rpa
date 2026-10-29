import type { NextRequest } from 'next/server';

import { criarApi } from '../../../../servidor/api';
import { lerConfig } from '../../../../servidor/config';
import { gravarCookies, redirecionar, respostaErro } from '../../../../servidor/respostas';
import { COOKIE_RENOVACAO, cookiesApagados, origemPermitida } from '../../../../servidor/sessao';

// Revoga a sessão na API e apaga os cookies, mesmo se a API falhar: o navegador sai de qualquer jeito.
export async function POST(request: NextRequest) {
  const { apiUrl, siteUrl } = lerConfig();
  if (!origemPermitida(request, siteUrl)) {
    return respostaErro(403, 'origem_proibida', 'Origem não permitida.');
  }

  const renovacao = request.cookies.get(COOKIE_RENOVACAO)?.value;
  if (renovacao) await criarApi({ url: apiUrl }).sair(renovacao);

  return gravarCookies(redirecionar('/entrar', siteUrl), cookiesApagados());
}
