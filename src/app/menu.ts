import type { Perfil } from './plataforma/contratos.js';

/** Sincronização com o Bling: só o admin das empresas da lista do `contratos` (hoje, a Roma). */
export { podeSincronizarBling } from './plataforma/contratos.js';

/** Automação do menu lateral do app. Cada uma tem a sua seção `section[data-aba=id]`. */
export type Automacao = { id: 'fatura' | 'op' | 'artes' | 'usuarios'; rotulo: string };

/** Fatura é o fluxo de documentos do Bling; Usuários lista e cria usuários nas empresas do admin. */
export const AUTOMACOES: Automacao[] = [
  { id: 'fatura', rotulo: 'Fatura' },
  { id: 'op', rotulo: 'OP' },
  { id: 'artes', rotulo: 'Artes' },
  { id: 'usuarios', rotulo: 'Usuários' },
];

/** Única empresa com Ordens de Produção (layout próprio da Roma). */
export const EMPRESA_OP = 'roma';

/** A OP é só do admin da Roma. O main repete esta checagem em cada canal da OP. */
export function podeUsarOp(perfil: Perfil, empresaSlug: string | undefined): boolean {
  return perfil === 'admin' && empresaSlug === EMPRESA_OP;
}

/**
 * Abas liberadas para o perfil na empresa em uso: o admin vê Artes, Fatura e Usuários, e a OP só na
 * Roma; a arte finalista, só Artes.
 */
export function abasDoPerfil(perfil: Perfil, empresaSlug?: string): Automacao[] {
  if (perfil !== 'admin') return AUTOMACOES.filter(({ id }) => id === 'artes');
  return AUTOMACOES.filter(({ id }) => id !== 'op' || podeUsarOp(perfil, empresaSlug));
}

/** Cópia em ordem alfabética (pt-BR), sem distinguir maiúsculas nem acentos. */
export function ordenarMenu<T extends { rotulo: string }>(itens: readonly T[]): T[] {
  return [...itens].sort((a, b) =>
    a.rotulo.localeCompare(b.rotulo, 'pt-BR', { sensitivity: 'base' }),
  );
}

/** A aba que abre ao iniciar: a primeira do menu. */
export function abaInicial<T extends { rotulo: string }>(itens: readonly T[]): T {
  const [primeira] = ordenarMenu(itens);
  if (!primeira) throw new Error('Menu de automações vazio');
  return primeira;
}

/** Ao remontar o menu (troca de empresa), fica na aba atual se ela continua liberada. */
export function abaAoRemontar<T extends { id: string; rotulo: string }>(
  itens: readonly T[],
  atual: string | undefined,
): T {
  return itens.find((item) => item.id === atual) ?? abaInicial(itens);
}
