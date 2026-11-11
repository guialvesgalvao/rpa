import {
  type ComentarioTarefa,
  type ContagemTarefas,
  nomeOuPadrao,
  type EscopoTarefas,
  type EventoTarefa,
  type OrigemTarefa,
  STATUS_EM_ANDAMENTO,
  type StatusTarefa,
  type Tarefa,
  type TarefaDetalhe,
} from '@plataforma/contratos';
import { and, asc, desc, eq, inArray, type SQL, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';

import {
  type Armazenamento,
  duplicada,
  gravarArquivo,
  inserirArte,
  NO_BANCO,
  type NovaArte,
  violouUnico,
} from '../artes/servico.js';
import { type ArquivoRecebido, comObjetosGravados } from '../arquivos/armazem.js';
import type { Banco } from '../db/cliente.js';
import {
  clientes,
  produtos,
  arquivos,
  tarefasArte,
  tarefasArteComentarioAnexos,
  tarefasArteComentarios,
  tarefasArteHistorico,
  usuarios,
} from '../db/esquema.js';
import { ErroApi } from '../erros.js';

// Quem pede: só alcança as tarefas de que é responsável, a não ser que acompanhe todas as da empresa
// (permissão `artes.acompanhar`).
export type Acesso = { usuarioId: string; veTodas: boolean };

const responsavel = alias(usuarios, 'responsavel');

const colunasTarefa = {
  id: tarefasArte.id,
  clienteId: clientes.id,
  clienteNome: clientes.nomeExibicao,
  produtoId: produtos.id,
  produtoNome: produtos.nome,
  responsavelId: responsavel.id,
  responsavelNome: responsavel.nome,
  status: tarefasArte.status,
  arteId: tarefasArte.arteId,
  origem: tarefasArte.origem,
  pedidoNumero: tarefasArte.pedidoNumero,
  criadoEm: tarefasArte.criadoEm,
  atualizadoEm: tarefasArte.atualizadoEm,
};

type LinhaTarefa = {
  id: string;
  clienteId: string;
  clienteNome: string | null;
  produtoId: string;
  produtoNome: string;
  responsavelId: string | null;
  responsavelNome: string | null;
  status: string;
  arteId: string | null;
  origem: string;
  pedidoNumero: string | null;
  criadoEm: Date;
  atualizadoEm: Date;
};

const pessoa = (id: string | null, nome: string | null) =>
  id && nome !== null ? { id, nome } : null;

function paraTarefa(linha: LinhaTarefa): Tarefa {
  return {
    id: linha.id,
    cliente: { id: linha.clienteId, nome: linha.clienteNome ?? '' },
    produto: { id: linha.produtoId, nome: linha.produtoNome },
    responsavel: pessoa(linha.responsavelId, linha.responsavelNome),
    status: linha.status as StatusTarefa,
    origem: linha.origem as OrigemTarefa,
    pedidoNumero: linha.pedidoNumero,
    arteId: linha.arteId,
    criadoEm: linha.criadoEm.toISOString(),
    atualizadoEm: linha.atualizadoEm.toISOString(),
  };
}

function consultaTarefas(db: Banco, filtro: SQL | undefined) {
  return db
    .select(colunasTarefa)
    .from(tarefasArte)
    .innerJoin(clientes, eq(clientes.id, tarefasArte.clienteId))
    .innerJoin(produtos, eq(produtos.id, tarefasArte.produtoId))
    .leftJoin(responsavel, eq(responsavel.id, tarefasArte.responsavelId))
    .where(filtro);
}

// Tarefa da empresa ao alcance de quem pede.
const alcance = (empresaId: string, acesso: Acesso, tarefaId?: string): SQL | undefined =>
  and(
    eq(tarefasArte.empresaId, empresaId),
    tarefaId ? eq(tarefasArte.id, tarefaId) : undefined,
    acesso.veTodas ? undefined : eq(tarefasArte.responsavelId, acesso.usuarioId),
  );

// `null` quando a tarefa não existe na empresa ou está fora do alcance de quem pede.
export async function obterTarefa(
  db: Banco,
  empresaId: string,
  tarefaId: string,
  acesso: Acesso,
): Promise<Tarefa | null> {
  const [linha] = await consultaTarefas(db, alcance(empresaId, acesso, tarefaId));
  return linha ? paraTarefa(linha) : null;
}

// Tarefa manual: `usuarioId` é quem cria e o responsável. Automática (worker dos pedidos): `usuarioId` nulo (o
// autor do primeiro evento é o sistema), `responsavelId` o automático (ou nulo) e a origem com o pedido.
export async function criarTarefa(
  db: Banco,
  entrada: {
    empresaId: string;
    clienteId: string;
    produtoId: string;
    usuarioId: string | null;
    responsavelId?: string | null;
    origem?: OrigemTarefa;
    pedidoNumero?: string;
  },
): Promise<Tarefa> {
  const responsavelId =
    entrada.responsavelId === undefined ? entrada.usuarioId : entrada.responsavelId;
  const tarefaId = await db.transaction(async (tx) => {
    const [tarefa] = await tx
      .insert(tarefasArte)
      .values({
        empresaId: entrada.empresaId,
        clienteId: entrada.clienteId,
        produtoId: entrada.produtoId,
        responsavelId,
        origem: entrada.origem ?? 'manual',
        pedidoNumero: entrada.pedidoNumero ?? null,
      })
      .returning({ id: tarefasArte.id, status: tarefasArte.status });
    if (!tarefa) throw new Error('Tarefa não criada.');
    await tx.insert(tarefasArteHistorico).values({
      tarefaId: tarefa.id,
      statusAnterior: null,
      statusNovo: tarefa.status,
      autorId: entrada.usuarioId,
    });
    return tarefa.id;
  });
  const criada = await obterTarefa(db, entrada.empresaId, tarefaId, {
    usuarioId: entrada.usuarioId ?? '',
    veTodas: true,
  });
  if (!criada) throw new Error('Tarefa não criada.');
  return criada;
}

// Mais recentes primeiro. Quem não acompanha todas só vê as próprias, qualquer que seja o escopo.
export async function listarTarefas(
  db: Banco,
  empresaId: string,
  acesso: Acesso,
  { escopo, status }: { escopo: EscopoTarefas; status?: StatusTarefa },
): Promise<Tarefa[]> {
  const soMinhas = escopo === 'minhas' || !acesso.veTodas;
  const linhas = await consultaTarefas(
    db,
    and(
      eq(tarefasArte.empresaId, empresaId),
      soMinhas ? eq(tarefasArte.responsavelId, acesso.usuarioId) : undefined,
      escopo === 'andamento' && !status
        ? inArray(tarefasArte.status, [...STATUS_EM_ANDAMENTO])
        : undefined,
      status ? eq(tarefasArte.status, status) : undefined,
    ),
  )
    .orderBy(desc(tarefasArte.atualizadoEm), desc(tarefasArte.id))
    .limit(500);
  return linhas.map(paraTarefa);
}

// Tarefas não terminadas por status, no alcance de quem pede; status sem tarefa vem 0.
export async function contarPorStatus(
  db: Banco,
  empresaId: string,
  acesso: Acesso,
): Promise<ContagemTarefas> {
  const linhas = await db
    .select({ status: tarefasArte.status, total: sql<number>`count(*)::int` })
    .from(tarefasArte)
    .where(and(alcance(empresaId, acesso), inArray(tarefasArte.status, [...STATUS_EM_ANDAMENTO])))
    .groupBy(tarefasArte.status);
  const contagem: ContagemTarefas = {
    nao_iniciada: 0,
    em_desenvolvimento: 0,
    aguardando_cliente: 0,
  };
  for (const { status, total } of linhas) {
    if (status in contagem) contagem[status as keyof ContagemTarefas] = total;
  }
  return contagem;
}

const semArte = () =>
  new ErroApi(
    409,
    'tarefa_sem_arte',
    'Para concluir, cadastre a arte: informe os arquivos, a cor e as máquinas.',
  );

// Muda o status e grava o histórico; o mesmo status não gera evento. `null` fora do alcance.
export async function mudarStatus(
  db: Banco,
  entrada: { empresaId: string; tarefaId: string; acesso: Acesso; status: StatusTarefa },
): Promise<Tarefa | null> {
  const { empresaId, tarefaId, acesso, status } = entrada;
  const encontrada = await db.transaction(async (tx) => {
    const [atual] = await tx
      .select({ id: tarefasArte.id, status: tarefasArte.status, arteId: tarefasArte.arteId })
      .from(tarefasArte)
      .where(alcance(empresaId, acesso, tarefaId))
      .for('update');
    if (!atual) return false;
    if (atual.status === status) return true;
    if (status === 'concluida' && !atual.arteId) throw semArte();
    await tx
      .update(tarefasArte)
      .set({ status, atualizadoEm: sql`now()` })
      .where(eq(tarefasArte.id, atual.id));
    await tx.insert(tarefasArteHistorico).values({
      tarefaId: atual.id,
      statusAnterior: atual.status,
      statusNovo: status,
      autorId: acesso.usuarioId,
    });
    return true;
  });
  return encontrada ? obterTarefa(db, empresaId, tarefaId, acesso) : null;
}

export type ArteDaConclusao = Omit<NovaArte, 'empresaId' | 'clienteId' | 'produtoId' | 'usuarioId'>;

// Cadastra a arte da tarefa (cliente e produto da tarefa) e a conclui, tudo numa transação. `null` fora do
// alcance; a tarefa que já tem arte é concluída só pela mudança de status.
export async function concluirTarefa(
  db: Banco,
  entrada: { empresaId: string; tarefaId: string; acesso: Acesso; arte: ArteDaConclusao },
  { armazem, log }: Armazenamento = NO_BANCO,
): Promise<Tarefa | null> {
  const { empresaId, tarefaId, acesso, arte } = entrada;
  try {
    const encontrada = await comObjetosGravados(
      armazem,
      [arte.pdf, arte.imagem],
      () =>
        db.transaction(async (tx) => {
          const [atual] = await tx
            .select({
              id: tarefasArte.id,
              status: tarefasArte.status,
              arteId: tarefasArte.arteId,
              clienteId: tarefasArte.clienteId,
              produtoId: tarefasArte.produtoId,
            })
            .from(tarefasArte)
            .where(alcance(empresaId, acesso, tarefaId))
            .for('update');
          if (!atual) return false;
          if (atual.arteId) {
            throw new ErroApi(
              409,
              'tarefa_com_arte',
              'Esta tarefa já tem arte cadastrada; mude o status para Concluída.',
            );
          }
          const arteId = await inserirArte(tx, {
            ...arte,
            empresaId,
            clienteId: atual.clienteId,
            produtoId: atual.produtoId,
            usuarioId: acesso.usuarioId,
          });
          await tx
            .update(tarefasArte)
            .set({ status: 'concluida', arteId, atualizadoEm: sql`now()` })
            .where(eq(tarefasArte.id, atual.id));
          await tx.insert(tarefasArteHistorico).values({
            tarefaId: atual.id,
            statusAnterior: atual.status,
            statusNovo: 'concluida',
            autorId: acesso.usuarioId,
          });
          return true;
        }),
      log,
    );
    return encontrada ? obterTarefa(db, empresaId, tarefaId, acesso) : null;
  } catch (erro) {
    if (violouUnico(erro)) throw duplicada(nomeOuPadrao(arte.nome));
    throw erro;
  }
}

const autor = alias(usuarios, 'autor');

async function comentariosDa(db: Banco, tarefaId: string): Promise<ComentarioTarefa[]> {
  const linhas = await db
    .select({
      id: tarefasArteComentarios.id,
      autorId: autor.id,
      autorNome: autor.nome,
      texto: tarefasArteComentarios.texto,
      criadoEm: tarefasArteComentarios.criadoEm,
    })
    .from(tarefasArteComentarios)
    .leftJoin(autor, eq(autor.id, tarefasArteComentarios.autorId))
    .where(eq(tarefasArteComentarios.tarefaId, tarefaId))
    .orderBy(asc(tarefasArteComentarios.criadoEm), asc(tarefasArteComentarios.id));
  const anexos = linhas.length
    ? await db
        .select({
          comentarioId: tarefasArteComentarioAnexos.comentarioId,
          id: arquivos.id,
          nome: arquivos.nomeOriginal,
          tipoMime: arquivos.tipoMime,
          tamanho: arquivos.tamanho,
        })
        .from(tarefasArteComentarioAnexos)
        .innerJoin(arquivos, eq(arquivos.id, tarefasArteComentarioAnexos.arquivoId))
        .where(
          inArray(
            tarefasArteComentarioAnexos.comentarioId,
            linhas.map((l) => l.id),
          ),
        )
        .orderBy(asc(tarefasArteComentarioAnexos.ordem))
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

export async function detalharTarefa(
  db: Banco,
  empresaId: string,
  tarefaId: string,
  acesso: Acesso,
): Promise<TarefaDetalhe | null> {
  const tarefa = await obterTarefa(db, empresaId, tarefaId, acesso);
  return tarefa ? { ...tarefa, comentarios: await comentariosDa(db, tarefaId) } : null;
}

// `null` fora do alcance. O texto já vem aparado e com o tamanho conferido; texto vazio só com anexo. Os anexos
// (tipo e tamanho já conferidos pela rota) vão para o armazém antes da transação.
export async function comentar(
  db: Banco,
  entrada: {
    empresaId: string;
    tarefaId: string;
    acesso: Acesso;
    texto: string;
    anexos?: ArquivoRecebido[];
  },
  { armazem, log }: Armazenamento = NO_BANCO,
): Promise<ComentarioTarefa | null> {
  const anexos = entrada.anexos ?? [];
  if (!entrada.texto && anexos.length === 0) {
    throw new ErroApi(400, 'comentario_vazio', 'Escreva o comentário ou anexe um arquivo.');
  }
  const tarefa = await obterTarefa(db, entrada.empresaId, entrada.tarefaId, entrada.acesso);
  if (!tarefa) return null;
  const comentarioId = await comObjetosGravados(
    armazem,
    anexos,
    () =>
      db.transaction(async (tx) => {
        const [linha] = await tx
          .insert(tarefasArteComentarios)
          .values({ tarefaId: tarefa.id, autorId: entrada.acesso.usuarioId, texto: entrada.texto })
          .returning({ id: tarefasArteComentarios.id });
        if (!linha) throw new Error('Comentário não gravado.');
        for (const [ordem, anexo] of anexos.entries()) {
          const arquivoId = await gravarArquivo(tx, anexo);
          await tx
            .insert(tarefasArteComentarioAnexos)
            .values({ comentarioId: linha.id, arquivoId, ordem });
        }
        return linha.id;
      }),
    log,
  );
  const comentario = (await comentariosDa(db, tarefa.id)).find((c) => c.id === comentarioId);
  if (!comentario) throw new Error('Comentário não gravado.');
  return comentario;
}

// Arquivo de um anexo de comentário da tarefa; `null` se a tarefa está fora do alcance ou o anexo não é dela.
export async function anexoDoComentario(
  db: Banco,
  entrada: {
    empresaId: string;
    tarefaId: string;
    comentarioId: string;
    anexoId: string;
    acesso: Acesso;
  },
): Promise<string | null> {
  const tarefa = await obterTarefa(db, entrada.empresaId, entrada.tarefaId, entrada.acesso);
  if (!tarefa) return null;
  const [linha] = await db
    .select({ arquivoId: tarefasArteComentarioAnexos.arquivoId })
    .from(tarefasArteComentarioAnexos)
    .innerJoin(
      tarefasArteComentarios,
      eq(tarefasArteComentarios.id, tarefasArteComentarioAnexos.comentarioId),
    )
    .where(
      and(
        eq(tarefasArteComentarios.tarefaId, tarefa.id),
        eq(tarefasArteComentarios.id, entrada.comentarioId),
        eq(tarefasArteComentarioAnexos.arquivoId, entrada.anexoId),
      ),
    );
  return linha?.arquivoId ?? null;
}

// Mudanças de status, da mais antiga (a criação) para a mais nova. `null` fora do alcance.
export async function historicoDaTarefa(
  db: Banco,
  empresaId: string,
  tarefaId: string,
  acesso: Acesso,
): Promise<EventoTarefa[] | null> {
  const tarefa = await obterTarefa(db, empresaId, tarefaId, acesso);
  if (!tarefa) return null;
  const linhas = await db
    .select({
      id: tarefasArteHistorico.id,
      statusAnterior: tarefasArteHistorico.statusAnterior,
      statusNovo: tarefasArteHistorico.statusNovo,
      autorId: autor.id,
      autorNome: autor.nome,
      criadoEm: tarefasArteHistorico.criadoEm,
    })
    .from(tarefasArteHistorico)
    .leftJoin(autor, eq(autor.id, tarefasArteHistorico.autorId))
    .where(eq(tarefasArteHistorico.tarefaId, tarefa.id))
    .orderBy(asc(tarefasArteHistorico.criadoEm), asc(tarefasArteHistorico.id));
  return linhas.map((l) => ({
    id: l.id,
    statusAnterior: l.statusAnterior as StatusTarefa | null,
    statusNovo: l.statusNovo as StatusTarefa,
    autor: pessoa(l.autorId, l.autorNome),
    criadoEm: l.criadoEm.toISOString(),
  }));
}
