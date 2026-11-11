import {
  type Area,
  type ComentarioCompra,
  type ConsultaCompras,
  type DadosEventoCompra,
  type EdicaoPedidoCompra,
  type EventoCompra,
  type Insumo,
  PREFIXO_INSUMO,
  type PedidoCompra,
  type PedidoCompraDetalhe,
  pedidoEditavel,
  rotuloInsumo,
  STATUS_COMPRA_EDITAVEIS,
  type StatusCompra,
} from '@plataforma/contratos';
import { and, asc, desc, eq, inArray, isNull, like, or, type SQL, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';

import { type Armazenamento, NO_BANCO } from '../artes/servico.js';
import { type ArquivoRecebido, comObjetosGravados } from '../arquivos/armazem.js';
import { gravarArquivo } from '../arquivos/gravar.js';
import type { Banco } from '../db/cliente.js';
import {
  arquivos,
  comprasComentarioAnexos,
  comprasComentarios,
  comprasHistorico,
  comprasPedidos,
  produtos,
  usuarios,
} from '../db/esquema.js';
import { ErroApi } from '../erros.js';

// Quem pede: `acompanha` (`compras.acompanhar`) alcança todos os pedidos da empresa; os demais, só os que criaram.
// `pede` (`compras.pedir`) é o que deixa o criador editar o próprio pedido.
export type AcessoCompras = { usuarioId: string; acompanha: boolean; pede: boolean };

type Transacao = Parameters<Parameters<Banco['transaction']>[0]>[0];
type Executor = Banco | Transacao;

const criador = alias(usuarios, 'criador');
const responsavel = alias(usuarios, 'responsavel');
const autor = alias(usuarios, 'autor');

const pessoa = (id: string | null, nome: string | null) =>
  id && nome !== null ? { id, nome } : null;

const proibido = () =>
  new ErroApi(403, 'permissao_proibida', 'Você não tem permissão para esta ação.');

const encerrado = () =>
  new ErroApi(409, 'pedido_encerrado', 'O pedido já foi concluído ou cancelado.');

const insumoInvalido = () =>
  new ErroApi(400, 'insumo_invalido', 'Escolha um insumo da lista (código começando por TPP).');

// Produto ativo da empresa com código de insumo. `like` com o prefixo fixo, sem curingas vindos de fora.
const ehInsumo = (empresaId: string): SQL | undefined =>
  and(
    eq(produtos.empresaId, empresaId),
    isNull(produtos.inativoNoBlingEm),
    like(produtos.codigo, `${PREFIXO_INSUMO}%`),
  );

export async function listarInsumos(db: Banco, empresaId: string): Promise<Insumo[]> {
  const linhas = await db
    .select({ id: produtos.id, codigo: produtos.codigo, nome: produtos.nome })
    .from(produtos)
    .where(ehInsumo(empresaId))
    .orderBy(asc(produtos.codigo));
  return linhas.map((linha) => ({ ...linha, codigo: linha.codigo ?? '' }));
}

async function buscarInsumo(tx: Executor, empresaId: string, id: string): Promise<Insumo> {
  const [linha] = await tx
    .select({ id: produtos.id, codigo: produtos.codigo, nome: produtos.nome })
    .from(produtos)
    .where(and(ehInsumo(empresaId), eq(produtos.id, id)));
  if (!linha) throw insumoInvalido();
  return { ...linha, codigo: linha.codigo ?? '' };
}

const colunasPedido = {
  id: comprasPedidos.id,
  insumoId: produtos.id,
  insumoCodigo: produtos.codigo,
  insumoNome: produtos.nome,
  quantidade: comprasPedidos.quantidade,
  observacao: comprasPedidos.observacao,
  status: comprasPedidos.status,
  criadorId: criador.id,
  criadorNome: criador.nome,
  areaCriador: comprasPedidos.areaCriador,
  responsavelId: responsavel.id,
  responsavelNome: responsavel.nome,
  criadoEm: comprasPedidos.criadoEm,
  atualizadoEm: comprasPedidos.atualizadoEm,
};

type LinhaPedido = {
  id: string;
  insumoId: string;
  insumoCodigo: string | null;
  insumoNome: string;
  quantidade: number;
  observacao: string | null;
  status: string;
  criadorId: string | null;
  criadorNome: string | null;
  areaCriador: string | null;
  responsavelId: string | null;
  responsavelNome: string | null;
  criadoEm: Date;
  atualizadoEm: Date;
};

function paraPedido(linha: LinhaPedido): PedidoCompra {
  return {
    id: linha.id,
    insumo: { id: linha.insumoId, codigo: linha.insumoCodigo ?? '', nome: linha.insumoNome },
    quantidade: Number(linha.quantidade),
    observacao: linha.observacao,
    status: linha.status as StatusCompra,
    criador: pessoa(linha.criadorId, linha.criadorNome),
    areaCriador: linha.areaCriador as Area | null,
    responsavel: pessoa(linha.responsavelId, linha.responsavelNome),
    criadoEm: linha.criadoEm.toISOString(),
    atualizadoEm: linha.atualizadoEm.toISOString(),
  };
}

function consultaPedidos(db: Banco, filtro: SQL | undefined) {
  return db
    .select(colunasPedido)
    .from(comprasPedidos)
    .innerJoin(produtos, eq(produtos.id, comprasPedidos.produtoId))
    .leftJoin(criador, eq(criador.id, comprasPedidos.criadoPor))
    .leftJoin(responsavel, eq(responsavel.id, comprasPedidos.responsavelId))
    .where(filtro);
}

// Pedido da empresa ao alcance de quem pede.
const alcance = (empresaId: string, acesso: AcessoCompras, pedidoId?: string): SQL | undefined =>
  and(
    eq(comprasPedidos.empresaId, empresaId),
    pedidoId ? eq(comprasPedidos.id, pedidoId) : undefined,
    acesso.acompanha ? undefined : eq(comprasPedidos.criadoPor, acesso.usuarioId),
  );

// `null` quando o pedido não existe na empresa ou está fora do alcance de quem pede.
export async function obterPedido(
  db: Banco,
  empresaId: string,
  pedidoId: string,
  acesso: AcessoCompras,
): Promise<PedidoCompra | null> {
  const [linha] = await consultaPedidos(db, alcance(empresaId, acesso, pedidoId));
  return linha ? paraPedido(linha) : null;
}

// Grava um evento do histórico; o `tipo` vai na coluna, o resto em `dados`.
async function registrar(
  tx: Transacao,
  pedidoId: string,
  autorId: string,
  { tipo, ...dados }: DadosEventoCompra,
): Promise<void> {
  await tx.insert(comprasHistorico).values({ pedidoId, tipo, dados, autorId });
}

export async function criarPedido(
  db: Banco,
  entrada: {
    empresaId: string;
    usuarioId: string;
    insumoId: string;
    quantidade: number;
    observacao?: string | null;
  },
): Promise<PedidoCompra> {
  const pedidoId = await db.transaction(async (tx) => {
    const insumo = await buscarInsumo(tx, entrada.empresaId, entrada.insumoId);
    const [quem] = await tx
      .select({ area: usuarios.area })
      .from(usuarios)
      .where(eq(usuarios.id, entrada.usuarioId));
    const [pedido] = await tx
      .insert(comprasPedidos)
      .values({
        empresaId: entrada.empresaId,
        produtoId: insumo.id,
        quantidade: entrada.quantidade,
        observacao: entrada.observacao ?? null,
        criadoPor: entrada.usuarioId,
        areaCriador: quem?.area ?? null,
      })
      .returning({ id: comprasPedidos.id });
    if (!pedido) throw new Error('Pedido não criado.');
    await registrar(tx, pedido.id, entrada.usuarioId, { tipo: 'criacao' });
    return pedido.id;
  });
  const criado = await obterPedido(db, entrada.empresaId, pedidoId, {
    usuarioId: entrada.usuarioId,
    acompanha: true,
    pede: true,
  });
  if (!criado) throw new Error('Pedido não criado.');
  return criado;
}

// Mais recentes primeiro. Quem não acompanha só vê os que criou, qualquer que seja o escopo.
export async function listarPedidos(
  db: Banco,
  empresaId: string,
  acesso: AcessoCompras,
  { escopo, status }: ConsultaCompras,
): Promise<PedidoCompra[]> {
  const linhas = await consultaPedidos(
    db,
    and(
      alcance(empresaId, acesso),
      escopo === 'meus'
        ? or(
            eq(comprasPedidos.criadoPor, acesso.usuarioId),
            eq(comprasPedidos.responsavelId, acesso.usuarioId),
          )
        : undefined,
      escopo === 'abertos' && !status
        ? inArray(comprasPedidos.status, [...STATUS_COMPRA_EDITAVEIS])
        : undefined,
      status ? eq(comprasPedidos.status, status) : undefined,
    ),
  )
    .orderBy(desc(comprasPedidos.atualizadoEm), desc(comprasPedidos.id))
    .limit(500);
  return linhas.map(paraPedido);
}

// Linha travada para a mudança, já no alcance de quem pede; `null` fora dele.
async function travar(tx: Transacao, empresaId: string, pedidoId: string, acesso: AcessoCompras) {
  const [atual] = await tx
    .select({
      id: comprasPedidos.id,
      produtoId: comprasPedidos.produtoId,
      quantidade: comprasPedidos.quantidade,
      observacao: comprasPedidos.observacao,
      status: comprasPedidos.status,
      criadoPor: comprasPedidos.criadoPor,
      responsavelId: comprasPedidos.responsavelId,
    })
    .from(comprasPedidos)
    .where(alcance(empresaId, acesso, pedidoId))
    .for('update');
  return atual ? { ...atual, status: atual.status as StatusCompra } : null;
}

const tocar = (
  tx: Transacao,
  pedidoId: string,
  campos: Partial<typeof comprasPedidos.$inferInsert>,
) =>
  tx
    .update(comprasPedidos)
    .set({ ...campos, atualizadoEm: sql`now()` })
    .where(eq(comprasPedidos.id, pedidoId));

// Insumo, quantidade e observação: o criador (com `compras.pedir`) ou quem acompanha, enquanto o pedido não
// terminou. O que não muda de verdade não gera evento. `null` fora do alcance.
export async function editarPedido(
  db: Banco,
  entrada: {
    empresaId: string;
    pedidoId: string;
    acesso: AcessoCompras;
    edicao: EdicaoPedidoCompra;
  },
): Promise<PedidoCompra | null> {
  const { empresaId, pedidoId, acesso, edicao } = entrada;
  const encontrado = await db.transaction(async (tx) => {
    const atual = await travar(tx, empresaId, pedidoId, acesso);
    if (!atual) return false;
    const ehCriador = atual.criadoPor === acesso.usuarioId;
    if (!acesso.acompanha && !(ehCriador && acesso.pede)) throw proibido();
    if (!pedidoEditavel(atual)) throw encerrado();

    const evento: Extract<DadosEventoCompra, { tipo: 'edicao' }> = { tipo: 'edicao' };
    const campos: Partial<typeof comprasPedidos.$inferInsert> = {};
    if (edicao.insumoId !== undefined && edicao.insumoId !== atual.produtoId) {
      const novo = await buscarInsumo(tx, empresaId, edicao.insumoId);
      const [antigo] = await tx
        .select({ codigo: produtos.codigo, nome: produtos.nome })
        .from(produtos)
        .where(eq(produtos.id, atual.produtoId));
      evento.insumo = {
        de: antigo ? rotuloInsumo({ codigo: antigo.codigo ?? '', nome: antigo.nome }) : '',
        para: rotuloInsumo(novo),
      };
      campos.produtoId = novo.id;
    }
    const quantidadeAtual = Number(atual.quantidade);
    if (edicao.quantidade !== undefined && edicao.quantidade !== quantidadeAtual) {
      evento.quantidade = { de: quantidadeAtual, para: edicao.quantidade };
      campos.quantidade = edicao.quantidade;
    }
    if (edicao.observacao !== undefined && edicao.observacao !== atual.observacao) {
      evento.observacao = { de: atual.observacao, para: edicao.observacao };
      campos.observacao = edicao.observacao;
    }
    if (Object.keys(campos).length === 0) return true;
    await tocar(tx, atual.id, campos);
    await registrar(tx, atual.id, acesso.usuarioId, evento);
    return true;
  });
  return encontrado ? obterPedido(db, empresaId, pedidoId, acesso) : null;
}

async function nomeDe(tx: Transacao, usuarioId: string | null) {
  if (!usuarioId) return null;
  const [linha] = await tx
    .select({ id: usuarios.id, nome: usuarios.nome })
    .from(usuarios)
    .where(eq(usuarios.id, usuarioId));
  return linha ?? null;
}

// Quem acompanha assume o pedido: vira o responsável e o pedido passa para Em andamento. `null` fora do alcance.
export async function assumirPedido(
  db: Banco,
  entrada: { empresaId: string; pedidoId: string; acesso: AcessoCompras },
): Promise<PedidoCompra | null> {
  const { empresaId, pedidoId, acesso } = entrada;
  const encontrado = await db.transaction(async (tx) => {
    const atual = await travar(tx, empresaId, pedidoId, acesso);
    if (!atual) return false;
    if (!pedidoEditavel(atual)) throw encerrado();
    const trocaResponsavel = atual.responsavelId !== acesso.usuarioId;
    const trocaStatus = atual.status !== 'em_andamento';
    if (!trocaResponsavel && !trocaStatus) return true;
    await tocar(tx, atual.id, { responsavelId: acesso.usuarioId, status: 'em_andamento' });
    if (trocaResponsavel) {
      const para = await nomeDe(tx, acesso.usuarioId);
      await registrar(tx, atual.id, acesso.usuarioId, {
        tipo: 'responsavel',
        de: await nomeDe(tx, atual.responsavelId),
        para,
      });
    }
    if (trocaStatus) {
      await registrar(tx, atual.id, acesso.usuarioId, {
        tipo: 'status',
        de: atual.status,
        para: 'em_andamento',
      });
    }
    return true;
  });
  return encontrado ? obterPedido(db, empresaId, pedidoId, acesso) : null;
}

// Quem acompanha muda para qualquer status; o criador só cancela o próprio pedido enquanto está Aberta. O mesmo
// status não gera evento. `null` fora do alcance.
export async function mudarStatusPedido(
  db: Banco,
  entrada: { empresaId: string; pedidoId: string; acesso: AcessoCompras; status: StatusCompra },
): Promise<PedidoCompra | null> {
  const { empresaId, pedidoId, acesso, status } = entrada;
  const encontrado = await db.transaction(async (tx) => {
    const atual = await travar(tx, empresaId, pedidoId, acesso);
    if (!atual) return false;
    if (atual.status === status) return true;
    const cancelaOProprio =
      atual.criadoPor === acesso.usuarioId && atual.status === 'aberta' && status === 'cancelada';
    if (!acesso.acompanha && !cancelaOProprio) throw proibido();
    await tocar(tx, atual.id, { status });
    await registrar(tx, atual.id, acesso.usuarioId, {
      tipo: 'status',
      de: atual.status,
      para: status,
    });
    return true;
  });
  return encontrado ? obterPedido(db, empresaId, pedidoId, acesso) : null;
}

// Eventos do mais antigo (a criação) para o mais novo. `null` fora do alcance.
export async function historicoDoPedido(
  db: Banco,
  empresaId: string,
  pedidoId: string,
  acesso: AcessoCompras,
): Promise<EventoCompra[] | null> {
  const pedido = await obterPedido(db, empresaId, pedidoId, acesso);
  if (!pedido) return null;
  const linhas = await db
    .select({
      id: comprasHistorico.id,
      tipo: comprasHistorico.tipo,
      dados: comprasHistorico.dados,
      autorId: autor.id,
      autorNome: autor.nome,
      criadoEm: comprasHistorico.criadoEm,
    })
    .from(comprasHistorico)
    .leftJoin(autor, eq(autor.id, comprasHistorico.autorId))
    .where(eq(comprasHistorico.pedidoId, pedido.id))
    .orderBy(asc(comprasHistorico.criadoEm), asc(comprasHistorico.id));
  return linhas.map((linha) => ({
    id: linha.id,
    dados: { ...linha.dados, tipo: linha.tipo } as DadosEventoCompra,
    autor: pessoa(linha.autorId, linha.autorNome),
    criadoEm: linha.criadoEm.toISOString(),
  }));
}

async function comentariosDo(db: Banco, pedidoId: string): Promise<ComentarioCompra[]> {
  const linhas = await db
    .select({
      id: comprasComentarios.id,
      autorId: autor.id,
      autorNome: autor.nome,
      texto: comprasComentarios.texto,
      criadoEm: comprasComentarios.criadoEm,
    })
    .from(comprasComentarios)
    .leftJoin(autor, eq(autor.id, comprasComentarios.autorId))
    .where(eq(comprasComentarios.pedidoId, pedidoId))
    .orderBy(asc(comprasComentarios.criadoEm), asc(comprasComentarios.id));
  const anexos = linhas.length
    ? await db
        .select({
          comentarioId: comprasComentarioAnexos.comentarioId,
          id: arquivos.id,
          nome: arquivos.nomeOriginal,
          tipoMime: arquivos.tipoMime,
          tamanho: arquivos.tamanho,
        })
        .from(comprasComentarioAnexos)
        .innerJoin(arquivos, eq(arquivos.id, comprasComentarioAnexos.arquivoId))
        .where(
          inArray(
            comprasComentarioAnexos.comentarioId,
            linhas.map((l) => l.id),
          ),
        )
        .orderBy(asc(comprasComentarioAnexos.ordem))
    : [];
  return linhas.map((l) => ({
    id: l.id,
    autor: pessoa(l.autorId, l.autorNome),
    texto: l.texto,
    anexos: anexos
      .filter((a) => a.comentarioId === l.id)
      .map(({ id, nome, tipoMime, tamanho }) => ({ id, nome, tipoMime, tamanho })),
    criadoEm: l.criadoEm.toISOString(),
  }));
}

// O pedido com os comentários. `null` fora do alcance.
export async function detalharPedido(
  db: Banco,
  empresaId: string,
  pedidoId: string,
  acesso: AcessoCompras,
): Promise<PedidoCompraDetalhe | null> {
  const pedido = await obterPedido(db, empresaId, pedidoId, acesso);
  return pedido ? { ...pedido, comentarios: await comentariosDo(db, pedido.id) } : null;
}

// Quem alcança o pedido comenta, em qualquer status. O texto já vem aparado e com o tamanho conferido; texto vazio
// só com anexo. Os anexos (tipo e tamanho já conferidos pela rota) vão para o armazém antes da transação. `null`
// fora do alcance.
export async function comentarPedido(
  db: Banco,
  entrada: {
    empresaId: string;
    pedidoId: string;
    acesso: AcessoCompras;
    texto: string;
    anexos?: ArquivoRecebido[];
  },
  { armazem, log }: Armazenamento = NO_BANCO,
): Promise<ComentarioCompra | null> {
  const anexos = entrada.anexos ?? [];
  if (!entrada.texto && anexos.length === 0) {
    throw new ErroApi(400, 'comentario_vazio', 'Escreva o comentário ou anexe um arquivo.');
  }
  const pedido = await obterPedido(db, entrada.empresaId, entrada.pedidoId, entrada.acesso);
  if (!pedido) return null;
  const comentarioId = await comObjetosGravados(
    armazem,
    anexos,
    () =>
      db.transaction(async (tx) => {
        const [linha] = await tx
          .insert(comprasComentarios)
          .values({ pedidoId: pedido.id, autorId: entrada.acesso.usuarioId, texto: entrada.texto })
          .returning({ id: comprasComentarios.id });
        if (!linha) throw new Error('Comentário não gravado.');
        for (const [ordem, anexo] of anexos.entries()) {
          const arquivoId = await gravarArquivo(tx, anexo);
          await tx
            .insert(comprasComentarioAnexos)
            .values({ comentarioId: linha.id, arquivoId, ordem });
        }
        return linha.id;
      }),
    log,
  );
  const comentario = (await comentariosDo(db, pedido.id)).find((c) => c.id === comentarioId);
  if (!comentario) throw new Error('Comentário não gravado.');
  return comentario;
}

// Arquivo de um anexo de comentário do pedido; `null` se o pedido está fora do alcance ou o anexo não é dele.
export async function anexoDoComentarioDoPedido(
  db: Banco,
  entrada: {
    empresaId: string;
    pedidoId: string;
    comentarioId: string;
    anexoId: string;
    acesso: AcessoCompras;
  },
): Promise<string | null> {
  const pedido = await obterPedido(db, entrada.empresaId, entrada.pedidoId, entrada.acesso);
  if (!pedido) return null;
  const [linha] = await db
    .select({ arquivoId: comprasComentarioAnexos.arquivoId })
    .from(comprasComentarioAnexos)
    .innerJoin(comprasComentarios, eq(comprasComentarios.id, comprasComentarioAnexos.comentarioId))
    .where(
      and(
        eq(comprasComentarios.pedidoId, pedido.id),
        eq(comprasComentarios.id, entrada.comentarioId),
        eq(comprasComentarioAnexos.arquivoId, entrada.anexoId),
      ),
    );
  return linha?.arquivoId ?? null;
}
