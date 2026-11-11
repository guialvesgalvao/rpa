import { SENHA_MINIMA } from '@plataforma/contratos';
import type { NextRequest } from 'next/server';

import { slugValido } from '../../../../empresas';
import { obterAcesso } from '../../../../servidor/acesso';
import { criarApi } from '../../../../servidor/api';
import { lerConfig } from '../../../../servidor/config';
import { gravarCookies, redirecionar, respostaErro } from '../../../../servidor/respostas';
import {
  COOKIE_RENOVACAO,
  cookiesApagados,
  origemPermitida,
  type Cookie,
} from '../../../../servidor/sessao';

// Formulário de `/trocar-senha`. A sessão deste navegador continua aberta (a API recebe o token de renovação
// dela); as outras são revogadas. Recusa volta para a página com `?erro=<codigo>`.
export async function POST(request: NextRequest) {
  const { apiUrl, siteUrl } = lerConfig();
  if (!origemPermitida(request, siteUrl)) {
    return respostaErro(403, 'origem_proibida', 'Origem não permitida.');
  }

  const api = criarApi({ url: apiUrl });
  const sessao = await obterAcesso(api, request.cookies, new Date());
  if (sessao.tipo === 'sem_sessao') {
    return gravarCookies(redirecionar('/entrar', siteUrl), cookiesApagados());
  }
  const novos: Cookie[] = sessao.tipo === 'valido' ? (sessao.novos ?? []) : [];
  const voltar = (codigo: string) =>
    gravarCookies(redirecionar(`/trocar-senha?erro=${encodeURIComponent(codigo)}`, siteUrl), novos);
  if (sessao.tipo === 'indisponivel') return voltar('indisponivel');

  const formulario = await request.formData().catch(() => undefined);
  const senhaAtual = formulario?.get('senhaAtual');
  const novaSenha = formulario?.get('novaSenha');
  const confirmacao = formulario?.get('confirmacao');
  const empresa = formulario?.get('empresa');
  if (typeof senhaAtual !== 'string' || typeof novaSenha !== 'string' || !senhaAtual) {
    return voltar('senha_atual_incorreta');
  }
  if (novaSenha.length < SENHA_MINIMA) return voltar('senha_curta');
  if (novaSenha !== confirmacao) return voltar('confirmacao');

  // Se o acesso acabou de ser renovado, a sessão deste navegador já tem o token novo.
  const renovacao =
    novos.find((cookie) => cookie.name === COOKIE_RENOVACAO)?.value ??
    request.cookies.get(COOKIE_RENOVACAO)?.value;
  const resultado = await api.trocarSenha(sessao.acesso, {
    senhaAtual,
    novaSenha,
    ...(renovacao ? { renovacao } : {}),
  });
  if (!resultado.ok) {
    if (resultado.status === 401) {
      return gravarCookies(redirecionar('/entrar', siteUrl), cookiesApagados());
    }
    const codigo = resultado.codigo === 'requisicao_invalida' ? 'senha_curta' : resultado.codigo;
    return voltar(codigo ?? 'falha');
  }

  const destino = slugValido(empresa) ? `/${empresa}` : '/entrar';
  return gravarCookies(redirecionar(destino, siteUrl), novos);
}
