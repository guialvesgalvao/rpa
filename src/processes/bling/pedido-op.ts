import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import type { Page } from 'playwright';
import { z } from 'zod';

import type { Rastro } from '../../core/rastro.js';
import { capturarObterVenda } from './pedido.js';

export const ERRO_SEM_INSUMOS = 'Produto sem insumos cadastrados';

export type InsumoOp = { nome: string; unidade: string; quantidadePorUnidade: number };

export type ItemOp = {
  descricao: string;
  codigo: string;
  unidade: string;
  quantidade: number;
  /** Ausente quando o item tem `erro`. */
  insumos?: InsumoOp[];
  erro?: string;
};

export type PedidoOp = {
  numero: string;
  clienteNome: string;
  clienteFantasia?: string;
  /** 14 dígitos, sem máscara. */
  cnpj?: string;
  dataVenda: Date;
  dataPrevista?: Date;
  itens: ItemOp[];
};

const numero = z.union([z.number(), z.string()]).pipe(z.coerce.number());

const schema = z.object({
  venda: z.object({
    numeroPedido: z.coerce.string(),
    data: z.string(),
    dataPrevista: z.string().nullish(),
    cnpj: z.string().nullish(),
  }),
  contato: z.object({
    dadosContato: z.object({
      nome: z.string().optional(),
      fantasia: z.string().optional(),
      cnpj: z.string().nullish(),
    }),
  }),
  itens: z.array(
    z.object({
      descricao: z.string(),
      codigo: z.coerce.string(),
      unidade: z.string().nullish(),
      quantidade: numero,
      componentes: z
        .array(z.object({ nome: z.string(), unidade: z.string().nullish(), quantidade: numero }))
        .nullish(),
      produto: z.object({ tipo: z.string().nullish() }).nullish(),
    }),
  ),
});

/** "19/10/2026" → Date local (meia-noite). */
function parseData(texto: string, rotulo: string): Date {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(texto.trim());
  const [, dia, mes, ano] = match ?? [];
  const data = new Date(Number(ano), Number(mes) - 1, Number(dia));
  if (!match || data.getDate() !== Number(dia) || data.getMonth() !== Number(mes) - 1) {
    throw new Error(`${rotulo} inválida: "${texto}"`);
  }
  return data;
}

/** Só os dígitos; devolve `undefined` se não houver 14 (CNPJ) — CPF/lixo não casa com cliente. */
function normalizarCnpj(texto: string | null | undefined): string | undefined {
  const digitos = (texto ?? '').replace(/\D/g, '');
  return digitos.length === 14 ? digitos : undefined;
}

/**
 * Extrai do `obterVenda` o que a OP precisa: cliente, datas, itens e insumos. Serviços
 * (`produto.tipo = "S"`) são descartados; produto sem `componentes` vira erro só naquele item.
 */
export function extrairPedidoOp(json: unknown, numeroEsperado?: string): PedidoOp {
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    const campo = parsed.error.issues[0]?.path.join('.') || 'resposta';
    throw new Error(`Dados do pedido ${numeroEsperado ?? ''} em formato inesperado (${campo})`);
  }
  const { venda, contato, itens } = parsed.data;
  if (numeroEsperado && venda.numeroPedido !== numeroEsperado) {
    throw new Error(`O Bling abriu o pedido ${venda.numeroPedido} em vez do ${numeroEsperado}`);
  }
  const { nome, fantasia, cnpj } = contato.dadosContato;
  const clienteNome = nome?.trim() || fantasia?.trim();
  if (!clienteNome) throw new Error(`Pedido ${venda.numeroPedido} sem nome de cliente`);
  const previsto = venda.dataPrevista?.trim();

  return {
    numero: venda.numeroPedido,
    clienteNome,
    clienteFantasia: fantasia?.trim() || undefined,
    cnpj: normalizarCnpj(cnpj) ?? normalizarCnpj(venda.cnpj),
    dataVenda: parseData(venda.data, 'Data da venda'),
    dataPrevista: previsto ? parseData(previsto, 'Data prevista') : undefined,
    itens: itens
      .filter((i) => i.produto?.tipo !== 'S')
      .map((i): ItemOp => {
        const base = {
          descricao: i.descricao,
          codigo: i.codigo,
          unidade: i.unidade?.trim() ?? '',
          quantidade: i.quantidade,
        };
        const componentes = i.componentes ?? [];
        if (!componentes.length) return { ...base, erro: ERRO_SEM_INSUMOS };
        return {
          ...base,
          insumos: componentes.map((c) => ({
            nome: c.nome,
            unidade: c.unidade?.trim() ?? '',
            quantidadePorUnidade: c.quantidade,
          })),
        };
      }),
  };
}

export type FontePedidoOp = (numero: string) => Promise<PedidoOp>;

/** Fonte real: abre o pedido no Bling (RPA) e lê o `obterVenda`. */
export function fonteBling(page: Page, rastro: Rastro): FontePedidoOp {
  return async (numero) => {
    const json = await capturarObterVenda(page, numero, rastro);
    return rastro.etapa('Li os dados do pedido (itens, datas e insumos)', async () =>
      extrairPedidoOp(json, numero),
    );
  };
}

/** Fonte fictícia: devolve sempre o pedido da fixture sintética, sem abrir o Bling. */
export function fonteMock(
  caminho = resolve(process.cwd(), 'tests/fixtures/pedido-op.json'),
): FontePedidoOp {
  return async () => extrairPedidoOp(JSON.parse(await readFile(caminho, 'utf8')) as unknown);
}

export const mockAtivo = (env: NodeJS.ProcessEnv = process.env): boolean => env.RPA_OP_MOCK === '1';
