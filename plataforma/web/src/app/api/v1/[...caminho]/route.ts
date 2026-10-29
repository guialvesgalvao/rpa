import { NextResponse, type NextRequest } from 'next/server';

import { obterAcesso } from '../../../../servidor/acesso';
import { criarApi } from '../../../../servidor/api';
import { lerConfig } from '../../../../servidor/config';
import { gravarCookies, respostaErro } from '../../../../servidor/respostas';
import { caminhoPermitido, cookiesApagados, origemPermitida } from '../../../../servidor/sessao';

// O navegador fala só com o site; o site repassa para a API com o token do cookie (BFF).
// Fica fora do matcher do `proxy.ts`, que bufferizaria o corpo (corte silencioso acima de 10 MB).
async function repassar(request: NextRequest): Promise<NextResponse> {
  const { apiUrl, siteUrl } = lerConfig();
  const api = criarApi({ url: apiUrl });

  // `/api/v1/x` → `/v1/x`, conferido depois da normalização do `URL`.
  const destino = api.endereco(
    request.nextUrl.pathname.slice('/api'.length),
    request.nextUrl.search,
  );
  if (!caminhoPermitido(destino.pathname)) {
    return respostaErro(404, 'nao_encontrado', 'Rota não encontrada.');
  }
  if (request.method !== 'GET' && !origemPermitida(request, siteUrl)) {
    return respostaErro(403, 'origem_proibida', 'Origem não permitida.');
  }

  const sessao = await obterAcesso(api, request.cookies, new Date());
  if (sessao.tipo === 'indisponivel') {
    return respostaErro(502, 'api_indisponivel', 'API indisponível. Tente novamente.');
  }
  if (sessao.tipo === 'sem_sessao') {
    return gravarCookies(
      respostaErro(401, 'nao_autenticado', 'Faça login para continuar.'),
      cookiesApagados(),
    );
  }

  // Só `Authorization` (do cookie) e `Content-Type` seguem para a API.
  const cabecalhos = new Headers({ authorization: `Bearer ${sessao.acesso}` });
  const tipo = request.headers.get('content-type');
  if (tipo) cabecalhos.set('content-type', tipo);

  const comCorpo = request.method !== 'GET' && request.body !== null;
  const init: RequestInit & { duplex?: 'half' } = {
    method: request.method,
    headers: cabecalhos,
    // Streaming: o corpo segue para a API sem ser lido inteiro na memória.
    ...(comCorpo && { body: request.body, duplex: 'half' }),
    redirect: 'manual',
    cache: 'no-store',
    signal: request.signal,
  };
  let resposta: Response;
  try {
    resposta = await api.repassar(destino, init);
  } catch (erro) {
    if (request.signal.aborted) throw erro;
    console.error(`API indisponível em ${destino.pathname}:`, erro);
    return respostaErro(502, 'api_indisponivel', 'API indisponível. Tente novamente.');
  }

  const saida = new NextResponse(resposta.body, { status: resposta.status });
  const tipoResposta = resposta.headers.get('content-type');
  if (tipoResposta) saida.headers.set('content-type', tipoResposta);
  return sessao.novos ? gravarCookies(saida, sessao.novos) : saida;
}

export const GET = repassar;
export const POST = repassar;
export const PATCH = repassar;
export const DELETE = repassar;
