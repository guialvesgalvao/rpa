import type { EmpresaTela } from '../api.js';
import { ROTULOS_PERFIL, type UsuarioResumo } from '../plataforma/contratos.js';

/** Com uma só empresa, ela vem marcada e travada no formulário; com várias, nenhuma marcada. */
export function empresasDoFormulario(empresas: readonly EmpresaTela[]): {
  opcoes: EmpresaTela[];
  fixa: boolean;
  marcadas: string[];
} {
  const opcoes = [...empresas].sort((a, b) =>
    a.nome.localeCompare(b.nome, 'pt-BR', { sensitivity: 'base' }),
  );
  const fixa = opcoes.length === 1;
  return { opcoes, fixa, marcadas: fixa ? opcoes.map((e) => e.slug) : [] };
}

/** Ex.: "Arte finalista · ABA, Roma" (nome da empresa quando conhecido; senão o slug). */
export function descreverUsuario(
  usuario: Pick<UsuarioResumo, 'perfil' | 'empresas' | 'ativo'>,
  empresas: readonly EmpresaTela[],
): string {
  const nomes = usuario.empresas.map(
    (slug) => empresas.find((empresa) => empresa.slug === slug)?.nome ?? slug,
  );
  const partes = [ROTULOS_PERFIL[usuario.perfil], nomes.join(', ')];
  if (!usuario.ativo) partes.push('inativo');
  return partes.join(' · ');
}
