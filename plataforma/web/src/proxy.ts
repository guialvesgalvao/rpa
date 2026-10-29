import { NextResponse, type NextRequest } from 'next/server';

import { obterAcesso } from './servidor/acesso';
import { criarApi } from './servidor/api';
import { lerConfig } from './servidor/config';
import { caminhoEntrar, gravarCookies, redirecionar } from './servidor/respostas';
import { cookiesApagados, destinoSeguro } from './servidor/sessao';

// Guarda das páginas: sem sessão vai para `/entrar`; acesso vencido é renovado aqui mesmo.
// Não valida a assinatura do token (o site não tem o segredo): quem valida é a API, nas chamadas da página.
export async function proxy(request: NextRequest) {
  const { apiUrl, siteUrl } = lerConfig();
  const sessao = await obterAcesso(criarApi({ url: apiUrl }), request.cookies, new Date());

  if (sessao.tipo !== 'valido') {
    const destino = destinoSeguro(request.nextUrl.pathname + request.nextUrl.search);
    const resposta = redirecionar(caminhoEntrar({ destino }), siteUrl);
    return sessao.tipo === 'sem_sessao' ? gravarCookies(resposta, cookiesApagados()) : resposta;
  }
  if (!sessao.novos) return NextResponse.next();

  // Os cookies novos valem já nesta requisição (para a página que vai ler o acesso) e no navegador.
  for (const cookie of sessao.novos) request.cookies.set(cookie.name, cookie.value);
  return gravarCookies(NextResponse.next({ request: { headers: request.headers } }), sessao.novos);
}

export const config = {
  // Fora: `/api/**` (o proxy da API trata a sessão sozinho e não pode ter o corpo bufferizado), `/_next/**`,
  // `/entrar`, arquivos estáticos (com extensão) e `/`, que só redireciona.
  matcher: ['/((?!api(?:/|$)|_next/|entrar(?:/|$)|.*\\.[^/]+$).+)'],
};
