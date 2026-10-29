import type { NextRequest } from 'next/server';

import { criarApi } from '../../../../servidor/api';
import { lerConfig } from '../../../../servidor/config';
import {
  caminhoEntrar,
  gravarCookies,
  redirecionar,
  respostaErro,
} from '../../../../servidor/respostas';
import {
  COOKIE_EMPRESA,
  destinoSeguro,
  empresaInicial,
  montarCookies,
  origemPermitida,
} from '../../../../servidor/sessao';

// Formulário de `/entrar`. Qualquer recusa volta com a mesma mensagem genérica (`?erro=1`).
export async function POST(request: NextRequest) {
  const { apiUrl, siteUrl } = lerConfig();
  if (!origemPermitida(request, siteUrl)) {
    return respostaErro(403, 'origem_proibida', 'Origem não permitida.');
  }

  const formulario = await request.formData().catch(() => undefined);
  const email = formulario?.get('email');
  const senha = formulario?.get('senha');
  const destino = destinoSeguro(formulario?.get('destino'));
  const falha = () => redirecionar(caminhoEntrar({ erro: true, destino }), siteUrl);
  if (typeof email !== 'string' || typeof senha !== 'string') return falha();

  const resultado = await criarApi({ url: apiUrl }).entrar(email, senha);
  if (!resultado.ok) return falha();

  // A API recusa (403) quem não tem empresa; `empresa` só falta se o contrato mudar.
  const empresa = empresaInicial(resultado.dados.eu, request.cookies.get(COOKIE_EMPRESA)?.value);
  if (!empresa) return falha();

  const inicio = destino ?? `/${encodeURIComponent(empresa)}/artes`;
  return gravarCookies(redirecionar(inicio, siteUrl), montarCookies(resultado.dados));
}
