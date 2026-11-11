import 'server-only';

import { EsquemaUsuarioDetalhe, type UsuarioDetalhe } from '@plataforma/contratos';
import { notFound } from 'next/navigation';
import { z } from 'zod';

import { lerDaApi } from './artes';

// Usuários da empresa, com área e permissões (painel de usuários). Sem o módulo Usuários, a API responde 403
// e a página vira 404.
export const usuariosDaEmpresa = (empresa: string): Promise<UsuarioDetalhe[]> =>
  lerDaApi(`/v1/empresas/${encodeURIComponent(empresa)}/usuarios`, z.array(EsquemaUsuarioDetalhe));

// Um usuário da empresa; de outra empresa, excluído ou inexistente: 404.
export async function usuarioDaEmpresa(empresa: string, id: string): Promise<UsuarioDetalhe> {
  const usuario = (await usuariosDaEmpresa(empresa)).find((candidato) => candidato.id === id);
  if (!usuario) notFound();
  return usuario;
}
