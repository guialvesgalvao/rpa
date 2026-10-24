import type { Page } from 'playwright';
import { z } from 'zod';

import type { Rastro } from '../../core/rastro.js';
import { buscarPedido, voltarParaListagem } from './guia.js';

/**
 * Dados do pedido usados nos documentos. `possuiNf`: o pedido já tem nota fiscal vinculada
 * (`venda.idNotaFiscalRef` diferente de "0"; achado da Task 7).
 */
export type DadosPedido = { numero: string; cliente: string; parcelas: Date[]; possuiNf: boolean };

/** Resposta que a tela de edição do pedido recebe ao abrir (achado da Task 2). */
const OBTER_VENDA = 'services/vendas.server.php?f=obterVenda';
const DETALHE_TIMEOUT_MS = 30_000;

const schema = z.object({
  venda: z.object({
    numeroPedido: z.coerce.string(),
    idNotaFiscalRef: z.coerce.string().optional(),
  }),
  contato: z.object({
    dadosContato: z.object({
      nome: z.string().optional(),
      fantasia: z.string().optional(),
    }),
  }),
  jsonParcelas: z.array(z.object({ dataVencimento: z.string() })),
});

/** "19/10/2026" → Date local (meia-noite). */
function parseData(texto: string): Date {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(texto.trim());
  const [, dia, mes, ano] = match ?? [];
  const data = new Date(Number(ano), Number(mes) - 1, Number(dia));
  if (!match || data.getDate() !== Number(dia) || data.getMonth() !== Number(mes) - 1) {
    throw new Error(`Data de vencimento inválida: "${texto}"`);
  }
  return data;
}

/**
 * Extrai cliente, vencimentos e se já há NF da resposta de `obterVenda`. O cliente é o nome
 * fantasia; se o cliente não tiver, o nome principal. As parcelas seguem a ordem de `jsonParcelas`.
 */
export function extrairDadosPedido(json: unknown, numero: string): DadosPedido {
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const campo = issue?.path.join('.') || 'resposta';
    throw new Error(`Dados do pedido ${numero} em formato inesperado (${campo})`);
  }
  const { venda, contato, jsonParcelas } = parsed.data;
  if (venda.numeroPedido !== numero) {
    throw new Error(`O Bling abriu o pedido ${venda.numeroPedido} em vez do ${numero}`);
  }
  const { fantasia, nome } = contato.dadosContato;
  const cliente = fantasia?.trim() || nome?.trim();
  if (!cliente) throw new Error(`Pedido ${numero} sem nome de cliente`);
  if (!jsonParcelas.length) throw new Error(`Pedido ${numero} sem parcelas`);
  const ref = venda.idNotaFiscalRef?.trim();
  return {
    numero,
    cliente,
    parcelas: jsonParcelas.map((p) => parseData(p.dataVencimento)),
    possuiNf: !!ref && ref !== '0',
  };
}

/**
 * Abre o pedido (clique no Número da linha) só para capturar a resposta de `obterVenda` e volta
 * à listagem sem salvar. A chamada direta ao endpoint responde "Unknown Function" (Task 2).
 */
export async function lerDadosPedido(
  page: Page,
  numero: string,
  rastro: Rastro,
): Promise<DadosPedido> {
  const row = await rastro.etapa(`Busquei o pedido ${numero} na listagem`, () =>
    buscarPedido(page, numero),
  );
  let json: unknown;
  try {
    json = await rastro.etapa(`Abri o pedido ${numero}`, async () => {
      const resposta = page.waitForResponse((r) => r.url().includes(OBTER_VENDA), {
        timeout: DETALHE_TIMEOUT_MS,
      });
      // Se o clique falhar, a espera pela resposta não fica como rejeição sem tratamento.
      resposta.catch(() => undefined);
      await row.locator('td:nth-child(2)').click();
      return (await resposta).json() as Promise<unknown>;
    });
  } finally {
    // Mesmo em falha, volta à listagem para o próximo pedido conseguir buscar.
    await rastro.etapa('Voltei à listagem sem salvar', () => voltarParaListagem(page));
  }
  return rastro.etapa('Li os dados do pedido (cliente e parcelas)', async () =>
    extrairDadosPedido(json, numero),
  );
}
