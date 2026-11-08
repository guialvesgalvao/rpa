import { STATUS_EM_ANDAMENTO } from '@plataforma/contratos';
import { and, eq, inArray } from 'drizzle-orm';

import type { Banco } from '../db/cliente.js';
import { artes, clientes, produtos, tarefasArte } from '../db/esquema.js';
import { resolverResponsavelAutomatico } from '../tarefas/responsavel.js';
import { criarTarefa } from '../tarefas/servico.js';
import type { PedidoAberto } from './pedidos.js';

export type ResultadoTarefasPedidos = {
  criadas: number;
  // Par cliente × produto que já tem arte ou tarefa aberta.
  jaAtendidos: number;
  semCliente: number;
  semProduto: number;
  semResponsavel: number;
  avisos: string[];
};

async function idDoCliente(db: Banco, empresaId: string, pedido: PedidoAberto) {
  const [porId] = await db
    .select({ id: clientes.id })
    .from(clientes)
    .where(and(eq(clientes.empresaId, empresaId), eq(clientes.idBling, pedido.contatoIdBling)));
  if (porId) return porId.id;
  if (!pedido.cnpj) return null;
  const [porCnpj] = await db
    .select({ id: clientes.id })
    .from(clientes)
    .where(and(eq(clientes.empresaId, empresaId), eq(clientes.cnpj, pedido.cnpj)));
  return porCnpj?.id ?? null;
}

async function jaAtendido(db: Banco, clienteId: string, produtoId: string): Promise<boolean> {
  const [arte] = await db
    .select({ id: artes.id })
    .from(artes)
    .where(and(eq(artes.clienteId, clienteId), eq(artes.produtoId, produtoId)))
    .limit(1);
  if (arte) return true;
  const [aberta] = await db
    .select({ id: tarefasArte.id })
    .from(tarefasArte)
    .where(
      and(
        eq(tarefasArte.clienteId, clienteId),
        eq(tarefasArte.produtoId, produtoId),
        inArray(tarefasArte.status, [...STATUS_EM_ANDAMENTO]),
      ),
    )
    .limit(1);
  return Boolean(aberta);
}

// Cria uma tarefa de arte para cada cliente × produto dos pedidos em aberto que ainda não tem arte nem tarefa
// aberta. Cliente (pelo id do Bling, depois CNPJ) e produto (pelo código) precisam já estar na base; os que
// faltam só entram no aviso agregado. O responsável é o automático da empresa (ou nenhum). Sem dado de cliente
// nos avisos: só contagens.
export async function criarTarefasDosPedidos(
  db: Banco,
  empresaId: string,
  pedidos: readonly PedidoAberto[],
): Promise<ResultadoTarefasPedidos> {
  const resultado: ResultadoTarefasPedidos = {
    criadas: 0,
    jaAtendidos: 0,
    semCliente: 0,
    semProduto: 0,
    semResponsavel: 0,
    avisos: [],
  };
  const responsavelId = await resolverResponsavelAutomatico(db, empresaId);
  const vistos = new Set<string>();

  for (const pedido of pedidos) {
    if (pedido.codigos.length === 0) continue;
    const clienteId = await idDoCliente(db, empresaId, pedido);
    if (!clienteId) {
      resultado.semCliente++;
      continue;
    }
    for (const codigo of pedido.codigos) {
      const [produto] = await db
        .select({ id: produtos.id })
        .from(produtos)
        .where(and(eq(produtos.empresaId, empresaId), eq(produtos.codigo, codigo)));
      if (!produto) {
        resultado.semProduto++;
        continue;
      }
      const par = `${clienteId}:${produto.id}`;
      if (vistos.has(par)) continue;
      vistos.add(par);
      if (await jaAtendido(db, clienteId, produto.id)) {
        resultado.jaAtendidos++;
        continue;
      }
      await criarTarefa(db, {
        empresaId,
        clienteId,
        produtoId: produto.id,
        usuarioId: null,
        responsavelId,
        origem: 'bling_pedido',
        pedidoNumero: pedido.numero,
      });
      resultado.criadas++;
      if (!responsavelId) resultado.semResponsavel++;
    }
  }

  if (resultado.criadas) {
    resultado.avisos.push(`${resultado.criadas} tarefa(s) de arte criada(s) a partir dos pedidos.`);
  }
  if (resultado.semResponsavel) {
    resultado.avisos.push(
      `${resultado.semResponsavel} tarefa(s) sem responsável: escolha o responsável pelas tarefas automáticas nas Configurações.`,
    );
  }
  if (resultado.semCliente) {
    resultado.avisos.push(
      `${resultado.semCliente} pedido(s) com cliente fora da base: nenhuma tarefa criada para eles.`,
    );
  }
  if (resultado.semProduto) {
    resultado.avisos.push(
      `${resultado.semProduto} item(ns) de pedido com produto fora da base: nenhuma tarefa criada para eles.`,
    );
  }
  return resultado;
}
