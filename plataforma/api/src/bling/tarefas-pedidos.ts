import {
  chaveClienteFinal,
  clienteFinalDoPedido,
  ehCodigoDeInsumo,
  STATUS_EM_ANDAMENTO,
} from '@plataforma/contratos';
import { and, eq, inArray, type SQL, sql } from 'drizzle-orm';

import type { Banco } from '../db/cliente.js';
import { artes, clientes, produtos, tarefasArte } from '../db/esquema.js';
import { resolverResponsavelAutomatico } from '../tarefas/responsavel.js';
import { criarTarefa } from '../tarefas/servico.js';
import type { PedidoAberto } from './pedidos.js';

// Pedidos com data a partir deste dia ("AAAA-MM-DD", o do deploy) separam as tarefas também pelo cliente final
// de revenda (ADR 0017). Os anteriores seguem a regra antiga (cliente × produto): as artes já feitas não têm
// cliente final gravado, e a regra nova recriaria de uma vez as tarefas delas.
export const CLIENTE_FINAL_DESDE = '2026-11-16';

export type ResultadoTarefasPedidos = {
  criadas: number;
  // Cliente × produto (× cliente final, nos pedidos a partir de `CLIENTE_FINAL_DESDE`) que já tem arte ou tarefa
  // aberta.
  jaAtendidos: number;
  semCliente: number;
  semProduto: number;
  semResponsavel: number;
  avisos: string[];
};

const colunasCliente = {
  id: clientes.id,
  razaoSocial: clientes.razaoSocial,
  nomeFantasia: clientes.nomeFantasia,
};

async function clienteDoPedido(db: Banco, empresaId: string, pedido: PedidoAberto) {
  const [porId] = await db
    .select(colunasCliente)
    .from(clientes)
    .where(and(eq(clientes.empresaId, empresaId), eq(clientes.idBling, pedido.contatoIdBling)));
  if (porId) return porId;
  if (!pedido.cnpj) return null;
  const [porCnpj] = await db
    .select(colunasCliente)
    .from(clientes)
    .where(and(eq(clientes.empresaId, empresaId), eq(clientes.cnpj, pedido.cnpj)));
  return porCnpj ?? null;
}

// A mesma expressão da coluna gerada `cliente_final_chave` (migração `0020`), aplicada ao valor do pedido.
const chaveClienteFinalSql = (valor: string): SQL =>
  sql`f_unaccent(lower(regexp_replace(btrim(${valor}::text), '\\s+', ' ', 'g')))`;

// `clienteFinal`: `undefined` = regra antiga (só cliente × produto); `null` ou texto = só as artes e tarefas com
// o mesmo cliente final (`null` casa com as sem cliente final).
function mesmoClienteFinal(
  coluna: typeof artes.clienteFinalChave | typeof tarefasArte.clienteFinalChave,
  clienteFinal: string | null | undefined,
): SQL | undefined {
  if (clienteFinal === undefined) return undefined;
  return clienteFinal === null
    ? sql`${coluna} is null`
    : sql`${coluna} = ${chaveClienteFinalSql(clienteFinal)}`;
}

async function jaAtendido(
  db: Banco,
  clienteId: string,
  produtoId: string,
  clienteFinal: string | null | undefined,
): Promise<boolean> {
  const [arte] = await db
    .select({ id: artes.id })
    .from(artes)
    .where(
      and(
        eq(artes.clienteId, clienteId),
        eq(artes.produtoId, produtoId),
        mesmoClienteFinal(artes.clienteFinalChave, clienteFinal),
      ),
    )
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
        mesmoClienteFinal(tarefasArte.clienteFinalChave, clienteFinal),
      ),
    )
    .limit(1);
  return Boolean(aberta);
}

const usaRegraDoClienteFinal = (pedido: PedidoAberto): boolean =>
  pedido.data !== null && pedido.data >= CLIENTE_FINAL_DESDE;

// Cria uma tarefa de arte para cada cliente × produto (× cliente final de revenda, nos pedidos a partir de
// `CLIENTE_FINAL_DESDE`) dos pedidos em aberto que ainda não tem arte nem tarefa aberta. O cliente final vem do
// "Nome" do endereço de entrega e é gravado na tarefa mesmo nos pedidos anteriores ao corte. Cliente (pelo id do Bling, depois CNPJ) e produto (pelo código) precisam já estar na base; os que
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
    const cliente = await clienteDoPedido(db, empresaId, pedido);
    if (!cliente) {
      resultado.semCliente++;
      continue;
    }
    const clienteId = cliente.id;
    const clienteFinal = clienteFinalDoPedido(pedido.nomeEntrega, cliente);
    const regraNova = usaRegraDoClienteFinal(pedido);
    for (const codigo of pedido.codigos) {
      // Insumo (código com letra) não tem arte: não vira tarefa nem conta como produto ausente.
      if (ehCodigoDeInsumo(codigo)) continue;
      const [produto] = await db
        .select({ id: produtos.id })
        .from(produtos)
        .where(and(eq(produtos.empresaId, empresaId), eq(produtos.codigo, codigo)));
      if (!produto) {
        resultado.semProduto++;
        continue;
      }
      // Só evita reconsultar o mesmo par no ciclo; a tarefa criada já é gravada, então `jaAtendido` também barra
      // os pedidos seguintes (inclusive os do outro lado do corte).
      const par = `${clienteId}:${produto.id}`;
      const chave = regraNova
        ? `${par}:${clienteFinal ? chaveClienteFinal(clienteFinal) : ''}`
        : par;
      if (vistos.has(chave)) continue;
      vistos.add(chave);
      if (await jaAtendido(db, clienteId, produto.id, regraNova ? clienteFinal : undefined)) {
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
        clienteFinal,
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
