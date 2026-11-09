import { z } from 'zod';

import type { AcessoBling, ClienteBling } from './cliente.js';
import { formatarDataBling, formatarDataHoraBling } from './datas.js';
import type { ModoSincronizacao } from './sincronizacao.js';

// Situação "Em aberto" dos pedidos de venda: o filtro `idsSituacoes[]` usa o id (6, `situacao.valor` 0),
// confirmado na conta real em 2026-11-09.
export const SITUACAO_EM_ABERTO = 6;

// Só pedidos com data nos últimos 30 dias geram tarefa (decisão do usuário, 2026-11-09): a conta tinha 1692
// pedidos em aberto desde 2024, e um detalhe por pedido a cada ciclo passaria do limite diário do Bling.
export const JANELA_PEDIDOS_DIAS = 30;
const DIA_MS = 24 * 60 * 60 * 1000;

// Só os campos usados; o zod descarta o resto (nenhum dado além destes sai do Bling).
const numero = z.union([z.number(), z.string()]).transform((valor) => String(valor).trim());
const textoOuNulo = z
  .string()
  .nullish()
  .transform((valor) => (valor?.trim() ? valor.trim() : null));

const EsquemaPedidoLista = z.object({ id: z.number().int().positive() });

const EsquemaPedidoDetalhe = z.object({
  numero,
  contato: z.object({
    id: z.number().int().positive(),
    numeroDocumento: textoOuNulo,
  }),
  itens: z
    .array(
      z.object({
        codigo: textoOuNulo,
        // Item sem produto do cadastro (serviço ou digitado à mão) não gera tarefa.
        produto: z.object({ id: z.number().int().nonnegative() }).nullish(),
      }),
    )
    .nullish()
    .transform((itens) => itens ?? []),
});

export type PedidoAberto = {
  numero: string;
  contatoIdBling: number;
  // Só os 14 dígitos; `null` para pessoa física ou documento ausente.
  cnpj: string | null;
  // Códigos dos produtos do pedido, sem repetição.
  codigos: string[];
};

function cnpjDe(documento: string | null): string | null {
  const digitos = documento?.replace(/\D/g, '') ?? '';
  return digitos.length === 14 ? digitos : null;
}

// Filtros das listagens: sempre em aberto e com data do pedido na janela. Completa: uma listagem. Incremental: os
// alterados entre `desde` e `ate` e os com data a partir do dia de `desde` (não se sabe se a inclusão conta como
// alteração no Bling), unidos pelo id.
export function filtrosPedidos(
  modo: ModoSincronizacao,
  agora: Date,
  situacaoId = SITUACAO_EM_ABERTO,
): Record<string, string | number>[] {
  const corte = new Date(agora.getTime() - JANELA_PEDIDOS_DIAS * DIA_MS);
  const base = { 'idsSituacoes[]': situacaoId, dataInicial: formatarDataBling(corte) };
  if (modo.tipo === 'completa') return [base];
  const desde = modo.desde > corte ? modo.desde : corte;
  return [
    {
      ...base,
      dataAlteracaoInicial: formatarDataHoraBling(modo.desde),
      dataAlteracaoFinal: formatarDataHoraBling(modo.ate),
    },
    { ...base, dataInicial: formatarDataBling(desde) },
  ];
}

// Pedidos de venda em aberto da janela, com o contato e os códigos dos produtos (a lista não traz os itens: um
// detalhe por pedido, no ritmo do cliente HTTP).
export async function lerPedidosAbertos(
  cliente: ClienteBling,
  acesso: AcessoBling,
  {
    modo = { tipo: 'completa' },
    agora = new Date(),
    situacaoId = SITUACAO_EM_ABERTO,
    sinal,
  }: { modo?: ModoSincronizacao; agora?: Date; situacaoId?: number; sinal?: AbortSignal } = {},
): Promise<PedidoAberto[]> {
  const ids = new Set<number>();
  for (const filtros of filtrosPedidos(modo, agora, situacaoId)) {
    const lista = await cliente.listarTodas(
      '/pedidos/vendas',
      filtros,
      EsquemaPedidoLista,
      acesso,
      undefined,
      sinal,
    );
    for (const { id } of lista) ids.add(id);
  }
  const pedidos: PedidoAberto[] = [];
  for (const id of ids) {
    sinal?.throwIfAborted();
    const detalhe = await cliente.obter(
      `/pedidos/vendas/${id}`,
      EsquemaPedidoDetalhe,
      acesso,
      sinal,
    );
    const codigos = [
      ...new Set(
        detalhe.itens
          .filter((item) => item.produto && item.produto.id > 0 && item.codigo)
          .map((item) => item.codigo as string),
      ),
    ];
    pedidos.push({
      numero: detalhe.numero,
      contatoIdBling: detalhe.contato.id,
      cnpj: cnpjDe(detalhe.contato.numeroDocumento),
      codigos,
    });
  }
  return pedidos;
}
