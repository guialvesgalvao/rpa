import type { Perfil } from './plataforma/contratos.js';

/** Automação do menu lateral do app. Cada uma tem a sua seção `section[data-aba=id]`. */
export type Automacao = { id: 'fatura' | 'op' | 'artes'; rotulo: string };

/** Fatura é o fluxo de documentos do Bling; Artes e OP ainda não têm processo. */
export const AUTOMACOES: Automacao[] = [
  { id: 'fatura', rotulo: 'Fatura' },
  { id: 'op', rotulo: 'OP' },
  { id: 'artes', rotulo: 'Artes' },
];

/** Abas liberadas para o perfil: o admin vê todas; a arte finalista, só Artes. */
export function abasDoPerfil(perfil: Perfil): Automacao[] {
  return perfil === 'admin' ? [...AUTOMACOES] : AUTOMACOES.filter(({ id }) => id === 'artes');
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
