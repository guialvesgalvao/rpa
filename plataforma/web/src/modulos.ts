import { type Eu, type Permissao, temPermissao } from '@plataforma/contratos';

// As abas do site; Configurações e as automações do app desktop não entram aqui. Toda aba tem a permissão do
// módulo dela (ADR 0011); a API confere de novo em cada rota.
export const ITENS_MENU: readonly { segmento: string; rotulo: string; permissao: Permissao }[] = [
  { segmento: 'artes', rotulo: 'Artes', permissao: 'artes' },
  { segmento: 'usuarios', rotulo: 'Usuários', permissao: 'usuarios' },
];

export type ItemMenu = (typeof ITENS_MENU)[number];

/** As abas que o usuário pode abrir nesta empresa, na ordem do menu. */
export function itensDoMenu(permissoes: readonly string[] | undefined): ItemMenu[] {
  return ITENS_MENU.filter((item) => temPermissao(permissoes, item.permissao));
}

/** As permissões do usuário na empresa; vazio se ele não é dela. */
export function permissoesNaEmpresa(eu: Pick<Eu, 'empresas'>, slug: string): string[] {
  return eu.empresas.find((empresa) => empresa.slug === slug)?.permissoes ?? [];
}

/** Onde a empresa abre: a primeira aba permitida. Sem nenhuma, a própria raiz, que explica a falta de acesso. */
export function inicioDaEmpresa(slug: string, permissoes: readonly string[] | undefined): string {
  const [primeira] = itensDoMenu(permissoes);
  return primeira ? `/${slug}/${primeira.segmento}` : `/${slug}`;
}
