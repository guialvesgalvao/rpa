import { type Permissao, temPermissao } from './plataforma/contratos.js';

/** Sincronização com o Bling: quem tem OP's nas empresas da lista do `contratos` (hoje, a Roma). */
export { podeSincronizarBling } from './plataforma/contratos.js';

/**
 * Automação do menu lateral do app. Cada uma tem a sua seção `section[data-aba=id]` e a permissão do módulo
 * dela (ADR 0011): aba nova só entra com a permissão correspondente no catálogo.
 */
export type Automacao = {
  id: 'fatura' | 'op' | 'artes' | 'usuarios';
  rotulo: string;
  permissao: Permissao;
};

/** Fatura é o fluxo de documentos do Bling; Usuários é o painel de usuários da empresa. */
export const AUTOMACOES: Automacao[] = [
  { id: 'fatura', rotulo: 'Fatura', permissao: 'faturas' },
  { id: 'op', rotulo: 'OP', permissao: 'ops' },
  { id: 'artes', rotulo: 'Artes', permissao: 'artes' },
  { id: 'usuarios', rotulo: 'Usuários', permissao: 'usuarios' },
];

/** Única empresa com Ordens de Produção (layout próprio da Roma). */
export const EMPRESA_OP = 'roma';

/** A OP é de quem tem a permissão, e só na Roma. O main repete esta checagem em cada canal da OP. */
export function podeUsarOp(
  permissoes: readonly string[] | undefined,
  empresaSlug: string | undefined,
): boolean {
  return temPermissao(permissoes, 'ops') && empresaSlug === EMPRESA_OP;
}

/** Credenciais do Bling em Configurações: de quem gera Faturas ou OPs (são elas que entram no Bling). */
export function podeConfigurarBling(permissoes: readonly string[] | undefined): boolean {
  return temPermissao(permissoes, 'faturas') || temPermissao(permissoes, 'ops');
}

/**
 * Abas liberadas pelas permissões do usuário na empresa em uso; a OP, além da permissão, só existe na Roma.
 * Sem nenhuma permissão, a lista vem vazia e a tela avisa que falta acesso.
 */
export function abasDaSessao(
  permissoes: readonly string[] | undefined,
  empresaSlug?: string,
): Automacao[] {
  return AUTOMACOES.filter(
    ({ id, permissao }) =>
      temPermissao(permissoes, permissao) && (id !== 'op' || empresaSlug === EMPRESA_OP),
  );
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

/** Ao remontar o menu (troca de empresa), fica na aba atual se ela continua liberada. Sem abas: nada. */
export function abaAoRemontar<T extends { id: string; rotulo: string }>(
  itens: readonly T[],
  atual: string | undefined,
): T | undefined {
  if (itens.length === 0) return undefined;
  return itens.find((item) => item.id === atual) ?? abaInicial(itens);
}
