import { parseNumeros } from './numeros.js';

export type DocTipo = 'boleto' | 'recibo' | 'nf';

export type PedidoSelecao = { numero: string; docs: DocTipo[] };

export const DOCS_PADRAO: DocTipo[] = ['boleto', 'recibo'];

/** Todos os documentos, na ordem em que aparecem na tela e são gerados. */
export const TODOS_DOCS: DocTipo[] = ['boleto', 'recibo', 'nf'];

/** Nome do documento como aparece para o usuário. */
export const DOC_LABEL: Record<DocTipo, string> = {
  boleto: 'Boleto',
  recibo: 'Recibo',
  nf: 'Nota fiscal',
};

export const MAX_INTERVALO = 200;

export type Intervalo = { numeros: string[]; erro?: string };

/** Expande o intervalo De/Até (inclusivo, crescente ou decrescente) em números de pedido. */
export function expandirIntervalo(de: string, ate: string): Intervalo {
  const inicio = de.trim();
  const fim = ate.trim();
  if (!inicio && !fim) return { numeros: [] };
  if (!inicio || !fim) return { numeros: [], erro: 'Preencha De e Até' };
  if (!/^\d+$/.test(inicio) || !/^\d+$/.test(fim)) {
    return { numeros: [], erro: 'Intervalo deve ter apenas números' };
  }
  const a = Number(inicio);
  const b = Number(fim);
  const total = Math.abs(b - a) + 1;
  if (total > MAX_INTERVALO) {
    return { numeros: [], erro: `Intervalo com ${total} pedidos (máx. ${MAX_INTERVALO})` };
  }
  const passo = b >= a ? 1 : -1;
  return { numeros: Array.from({ length: total }, (_, i) => String(a + i * passo)) };
}

export type Selecao = {
  /** União sem duplicados: primeiro os do texto, depois os do intervalo. */
  numeros: string[];
  invalidos: string[];
  erroIntervalo?: string;
};

/** Junta a lista livre e o intervalo De/Até numa única lista de pedidos. */
export function montarSelecao(texto: string, de: string, ate: string): Selecao {
  const { validos, invalidos } = parseNumeros(texto);
  const intervalo = expandirIntervalo(de, ate);
  const numeros = [...new Set([...validos, ...intervalo.numeros])];
  return intervalo.erro
    ? { numeros, invalidos, erroIntervalo: intervalo.erro }
    : { numeros, invalidos };
}

/** Escolha do usuário para um pedido na lista de confirmação. */
export type EscolhaPedido = { marcado: boolean; docs: Set<DocTipo> };

/**
 * Monta as escolhas da lista de confirmação: o pedido que já estava nela mantém a escolha; o novo
 * entra marcado, com os documentos padrão que já estão disponíveis.
 */
export function reconstruirEscolhas(
  numeros: string[],
  anteriores: ReadonlyMap<string, EscolhaPedido>,
  disponiveis: readonly DocTipo[],
): Map<string, EscolhaPedido> {
  const padrao = DOCS_PADRAO.filter((doc) => disponiveis.includes(doc));
  return new Map(
    numeros.map((numero) => [
      numero,
      anteriores.get(numero) ?? { marcado: true, docs: new Set(padrao) },
    ]),
  );
}

/** Pedidos marcados com ao menos um documento, na ordem da lista e com os docs na ordem fixa. */
export function selecaoParaGerar(escolhas: ReadonlyMap<string, EscolhaPedido>): PedidoSelecao[] {
  const selecao: PedidoSelecao[] = [];
  for (const [numero, { marcado, docs }] of escolhas) {
    const escolhidos = TODOS_DOCS.filter((doc) => docs.has(doc));
    if (marcado && escolhidos.length) selecao.push({ numero, docs: escolhidos });
  }
  return selecao;
}

/**
 * Lê o valor de `--docs=` da CLI (ex.: "boleto,recibo"). Sem valor, usa `DOCS_PADRAO`. Lança erro
 * para documento desconhecido ou ainda não disponível. Devolve os docs sem repetição, na ordem fixa.
 */
export function parseDocs(valor: string | undefined, disponiveis: readonly DocTipo[]): DocTipo[] {
  if (valor === undefined) return DOCS_PADRAO.filter((doc) => disponiveis.includes(doc));
  const pedidos = valor
    .split(',')
    .map((doc) => doc.trim().toLowerCase())
    .filter(Boolean);
  if (!pedidos.length) throw new Error('Informe ao menos um documento em --docs');
  for (const doc of pedidos) {
    if (!(TODOS_DOCS as string[]).includes(doc)) {
      throw new Error(`Documento desconhecido em --docs: "${doc}" (use ${disponiveis.join(', ')})`);
    }
    if (!disponiveis.includes(doc as DocTipo)) {
      throw new Error(`${DOC_LABEL[doc as DocTipo]} ainda não disponível`);
    }
  }
  return TODOS_DOCS.filter((doc) => pedidos.includes(doc));
}
