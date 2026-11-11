import 'server-only';

import { type Eu, type Permissao, temPermissao } from '@plataforma/contratos';
import { cookies } from 'next/headers';
import { notFound, redirect } from 'next/navigation';

import { permissoesNaEmpresa } from '../modulos';
import { criarApi } from './api';
import { lerConfig } from './config';
import { COOKIE_ACESSO } from './sessao';

// O usuário da sessão com as empresas atuais (do banco, não do token). O `proxy.ts` já renovou o acesso,
// mas não confere a assinatura: um cookie forjado só é recusado aqui, pela API (401 → `/entrar`).
export async function usuarioDaSessao(): Promise<Eu> {
  const acesso = (await cookies()).get(COOKIE_ACESSO)?.value;
  if (!acesso) redirect('/entrar');

  const resultado = await criarApi({ url: lerConfig().apiUrl }).eu(acesso);
  if (resultado.ok) return resultado.dados;
  if (resultado.status === 401) redirect('/entrar');
  throw new Error(`A API respondeu ${resultado.status} em /v1/eu.`);
}

// Para as páginas de um módulo: o usuário e as permissões dele na empresa; sem a permissão pedida, 404.
// A API confere de novo em cada rota: isto só evita mostrar uma tela que não funcionaria.
export async function exigirPermissaoNaPagina(
  empresa: string,
  chave: Permissao,
): Promise<{ eu: Eu; permissoes: string[] }> {
  const eu = await usuarioDaSessao();
  const permissoes = permissoesNaEmpresa(eu, empresa);
  if (!temPermissao(permissoes, chave)) notFound();
  return { eu, permissoes };
}
