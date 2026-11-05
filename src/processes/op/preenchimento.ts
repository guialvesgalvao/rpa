import { PASSOS_PROCESSO } from './template.js';
import type { MarcaProcesso } from './tipos.js';

/** Data no formato do `<input type="date">`: `AAAA-MM-DD`. */
export type DataIso = string;

/** Uma linha da "Descrição do Processo" preenchida na tela. O Visto fica para o papel. */
export type LinhaProcessoPreenchida = {
  aplica?: MarcaProcesso;
  quantidade?: string;
  responsavel?: string;
  data?: DataIso;
};

/**
 * Dados da OP que hoje saem em branco, informados na tela antes de gerar. `processo` tem uma linha
 * por passo de `PASSOS_PROCESSO`, na mesma ordem. Não é guardado: vale só para a geração.
 */
export type PreenchimentoOp = {
  dataEntrega?: DataIso;
  processo?: LinhaProcessoPreenchida[];
  observacao?: string;
};

/** Tetos que mantêm a OP em uma página A4 (ver o teste do PDF). */
export const LIMITES_PREENCHIMENTO = {
  quantidade: 12,
  responsavel: 28,
  observacao: 400,
  /** Linhas da Observação; as quebras a mais viram espaço. */
  linhasObservacao: 4,
} as const;

const DATA_ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

/** `AAAA-MM-DD` → data local (meia-noite), sem o deslocamento de fuso do `new Date(iso)`. */
export function dataLocal(iso: DataIso): Date | undefined {
  const m = DATA_ISO.exec(iso);
  if (!m) return undefined;
  const [ano, mes, dia] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const data = new Date(ano, mes - 1, dia);
  const valida =
    data.getFullYear() === ano && data.getMonth() === mes - 1 && data.getDate() === dia;
  return valida ? data : undefined;
}

export const dataIsoValida = (iso: string): boolean => dataLocal(iso) !== undefined;

const texto = (valor: string | undefined): string | undefined => valor?.trim() || undefined;

/** Junta com espaço o que passar de `max` linhas, para a Observação não empurrar a OP para 2 páginas. */
export function limitarLinhas(valor: string, max: number): string {
  const linhas = valor.split(/\r?\n/);
  if (linhas.length <= max) return linhas.join('\n');
  return [...linhas.slice(0, max - 1), linhas.slice(max - 1).join(' ')].join('\n');
}

function normalizarLinha(linha: LinhaProcessoPreenchida | undefined): LinhaProcessoPreenchida {
  const quantidade = texto(linha?.quantidade);
  const responsavel = texto(linha?.responsavel);
  const data = texto(linha?.data);
  return {
    ...(linha?.aplica ? { aplica: linha.aplica } : {}),
    ...(quantidade ? { quantidade } : {}),
    ...(responsavel ? { responsavel } : {}),
    ...(data ? { data } : {}),
  };
}

const linhaVazia = (linha: LinhaProcessoPreenchida): boolean => Object.keys(linha).length === 0;

/**
 * Tira espaços e campos vazios. Sem nenhum dado, devolve `undefined` (a OP sai em branco, como
 * antes). `processo` sempre volta com uma linha por passo.
 */
export function normalizarPreenchimento(
  preenchimento: PreenchimentoOp | undefined,
): PreenchimentoOp | undefined {
  if (!preenchimento) return undefined;
  const dataEntrega = texto(preenchimento.dataEntrega);
  const observacao =
    limitarLinhas(preenchimento.observacao ?? '', LIMITES_PREENCHIMENTO.linhasObservacao).trim() ||
    undefined;
  const processo = PASSOS_PROCESSO.map((_, i) => normalizarLinha(preenchimento.processo?.[i]));
  const comProcesso = processo.some((l) => !linhaVazia(l));
  if (!dataEntrega && !observacao && !comProcesso) return undefined;
  return {
    ...(dataEntrega ? { dataEntrega } : {}),
    ...(comProcesso ? { processo } : {}),
    ...(observacao ? { observacao } : {}),
  };
}

export const temPreenchimento = (preenchimento: PreenchimentoOp | undefined): boolean =>
  normalizarPreenchimento(preenchimento) !== undefined;
