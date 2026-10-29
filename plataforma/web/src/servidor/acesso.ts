import 'server-only';

import type { Api } from './api';
import {
  COOKIE_ACESSO,
  COOKIE_RENOVACAO,
  montarCookies,
  precisaRenovar,
  type Cookie,
} from './sessao';

type CookiesRequisicao = { get(nome: string): { value: string } | undefined };

// `novos`: cookies a gravar na resposta quando houve renovação.
// `sem_sessao`: sem cookie ou a API recusou a renovação; os cookies devem ser apagados.
// `indisponivel`: a API falhou (5xx ou fora do ar); os cookies ficam para a próxima tentativa.
export type Acesso =
  | { tipo: 'valido'; acesso: string; novos?: Cookie[] }
  | { tipo: 'sem_sessao' }
  | { tipo: 'indisponivel' };

// O token de acesso do cookie, renovado pela API quando está para vencer.
export async function obterAcesso(
  api: Api,
  cookies: CookiesRequisicao,
  agora: Date,
): Promise<Acesso> {
  const acesso = cookies.get(COOKIE_ACESSO)?.value;
  if (acesso && !precisaRenovar(acesso, agora)) return { tipo: 'valido', acesso };

  const renovacao = cookies.get(COOKIE_RENOVACAO)?.value;
  if (!renovacao) return { tipo: 'sem_sessao' };

  const resultado = await api.renovar(renovacao);
  if (resultado.ok) {
    return {
      tipo: 'valido',
      acesso: resultado.dados.acesso,
      novos: montarCookies(resultado.dados),
    };
  }
  return resultado.status >= 500 ? { tipo: 'indisponivel' } : { tipo: 'sem_sessao' };
}
