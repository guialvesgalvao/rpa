import 'server-only';

import type { Eu } from '@plataforma/contratos';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

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
