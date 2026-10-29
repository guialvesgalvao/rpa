import type { NextRequest } from 'next/server';

import { slugValido } from '../../../../empresas';
import { lerConfig } from '../../../../servidor/config';
import { gravarCookies, redirecionar, respostaErro } from '../../../../servidor/respostas';
import { cookieEmpresa, origemPermitida } from '../../../../servidor/sessao';

// Formulário do seletor de empresa: grava `rpa_empresa` e abre as artes da empresa escolhida.
// Não confere o acesso: o layout de `/{empresa}` responde 404 para empresa alheia, e o login ignora o cookie.
export async function POST(request: NextRequest) {
  const { siteUrl } = lerConfig();
  if (!origemPermitida(request, siteUrl)) {
    return respostaErro(403, 'origem_proibida', 'Origem não permitida.');
  }

  const formulario = await request.formData().catch(() => undefined);
  const empresa = formulario?.get('empresa');
  if (!slugValido(empresa)) return respostaErro(400, 'empresa_invalida', 'Empresa inválida.');

  return gravarCookies(redirecionar(`/${empresa}/artes`, siteUrl), [cookieEmpresa(empresa)]);
}
