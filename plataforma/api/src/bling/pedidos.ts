import { z } from 'zod';

import type { AcessoBling, ClienteBling } from './cliente.js';

// Situação "Em aberto" dos pedidos de venda. HIPÓTESE (a confirmar com a conta real, Task 15 do plano): o id
// padrão do Bling é 6; se a conta usar outro, ele entra aqui ou vira configuração.
export const SITUACAO_EM_ABERTO = 6;

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

// Pedidos de venda em aberto, com o contato e os códigos dos produtos (a lista não traz os itens: um detalhe por
// pedido, no ritmo do cliente HTTP).
export async function lerPedidosAbertos(
  cliente: ClienteBling,
  acesso: AcessoBling,
  { situacaoId = SITUACAO_EM_ABERTO, sinal }: { situacaoId?: number; sinal?: AbortSignal } = {},
): Promise<PedidoAberto[]> {
  const lista = await cliente.listarTodas(
    '/pedidos/vendas',
    { 'idsSituacoes[]': situacaoId },
    EsquemaPedidoLista,
    acesso,
    undefined,
    sinal,
  );
  const pedidos: PedidoAberto[] = [];
  for (const { id } of lista) {
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
