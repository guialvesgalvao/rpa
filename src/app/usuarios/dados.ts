import type { EmpresaSessaoTela, EmpresaTela } from '../api.js';
import {
  type Permissao,
  rotuloArea,
  temPermissao,
  type UsuarioDetalhe,
} from '../plataforma/contratos.js';

/** Com uma só empresa, ela vem marcada e travada no formulário; com várias, nenhuma marcada. */
export function empresasDoFormulario<T extends EmpresaTela>(
  empresas: readonly T[],
): {
  opcoes: T[];
  fixa: boolean;
  marcadas: string[];
} {
  const opcoes = [...empresas].sort((a, b) =>
    a.nome.localeCompare(b.nome, 'pt-BR', { sensitivity: 'base' }),
  );
  const fixa = opcoes.length === 1;
  return { opcoes, fixa, marcadas: fixa ? opcoes.map((e) => e.slug) : [] };
}

/** Ex.: "Produção · ABA, Roma" (nome da empresa quando conhecido; senão o slug). */
export function descreverUsuario(
  usuario: Pick<UsuarioDetalhe, 'area' | 'empresas' | 'ativo'>,
  empresas: readonly EmpresaTela[],
): string {
  const nomes = usuario.empresas.map(
    ({ slug }) => empresas.find((empresa) => empresa.slug === slug)?.nome ?? slug,
  );
  const partes = [rotuloArea(usuario.area), nomes.join(', ')];
  if (!usuario.ativo) partes.push('inativo');
  return partes.join(' · ');
}

/** Empresas de quem usa o app em que ele tem a permissão (as que pode dar, ou em que marca permissões). */
export function empresasCom(
  empresas: readonly EmpresaSessaoTela[],
  chave: Permissao,
): EmpresaSessaoTela[] {
  return empresas.filter((empresa) => temPermissao(empresa.permissoes, chave));
}

/**
 * Nome, e-mail, área, empresas e a exclusão valem para o usuário inteiro: só mexe quem pode editar usuários em
 * todas as empresas dele (a API repete a regra).
 */
export function podeEditarDados(
  usuario: Pick<UsuarioDetalhe, 'empresas'>,
  empresas: readonly EmpresaSessaoTela[],
): boolean {
  const editaveis = empresasCom(empresas, 'usuarios.editar').map((empresa) => empresa.slug);
  return usuario.empresas.every(({ slug }) => editaveis.includes(slug));
}
