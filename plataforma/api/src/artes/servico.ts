import { createHash } from 'node:crypto';

import { type Arte, nomeOuPadrao } from '@plataforma/contratos';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';

import type { Banco } from '../db/cliente.js';
import { arquivos, arteMaquinas, artes, cores, maquinas, produtos } from '../db/esquema.js';
import { ErroApi } from '../erros.js';

export type ArquivoRecebido = { nomeOriginal: string; tipoMime: string; conteudo: Buffer };

export type NovaArte = {
  empresaId: string;
  clienteId: string;
  usuarioId: string;
  produtoId: string;
  nome?: string;
  corId: string;
  maquinaIds: string[];
  pdf?: ArquivoRecebido;
  imagem?: ArquivoRecebido;
};

// Campos ausentes ficam como estão. `remover*` tira o arquivo (só vale se sobrar outro).
export type EdicaoArte = {
  empresaId: string;
  arteId: string;
  usuarioId: string;
  produtoId?: string;
  nome?: string;
  corId?: string;
  maquinaIds?: string[];
  pdf?: ArquivoRecebido;
  imagem?: ArquivoRecebido;
  removerPdf?: boolean;
  removerImagem?: boolean;
};

type Transacao = Parameters<Parameters<Banco['transaction']>[0]>[0];

const invalida = (mensagem: string) => new ErroApi(422, 'validacao', mensagem);

// O Drizzle embrulha o erro do Postgres em `cause`.
function violouUnico(erro: unknown): boolean {
  const comCausa = erro as { code?: string; cause?: { code?: string } };
  return (comCausa.cause?.code ?? comCausa.code) === '23505';
}

const duplicada = (nome: string) =>
  new ErroApi(409, 'arte_duplicada', `Já existe uma arte '${nome}' para este produto`);

async function conferirReferencias(
  tx: Transacao,
  empresaId: string,
  { produtoId, corId, maquinaIds }: { produtoId?: string; corId?: string; maquinaIds?: string[] },
): Promise<void> {
  if (produtoId) {
    const [produto] = await tx
      .select({ id: produtos.id })
      .from(produtos)
      .where(and(eq(produtos.id, produtoId), eq(produtos.empresaId, empresaId)));
    if (!produto) throw invalida('Produto não encontrado nesta empresa.');
  }
  if (corId) {
    const [cor] = await tx.select({ id: cores.id }).from(cores).where(eq(cores.id, corId));
    if (!cor) throw invalida('Cor não encontrada.');
  }
  if (maquinaIds) {
    if (maquinaIds.length === 0) throw invalida('Selecione ao menos uma máquina.');
    const unicas = [...new Set(maquinaIds)];
    const encontradas = await tx
      .select({ id: maquinas.id })
      .from(maquinas)
      .where(inArray(maquinas.id, unicas));
    if (encontradas.length !== unicas.length) throw invalida('Máquina não encontrada.');
  }
}

async function gravarArquivo(tx: Transacao, arquivo: ArquivoRecebido): Promise<string> {
  const [linha] = await tx
    .insert(arquivos)
    .values({
      nomeOriginal: arquivo.nomeOriginal,
      tipoMime: arquivo.tipoMime,
      tamanho: arquivo.conteudo.length,
      sha256: createHash('sha256').update(arquivo.conteudo).digest('hex'),
      conteudo: arquivo.conteudo,
    })
    .returning({ id: arquivos.id });
  if (!linha) throw new Error('Arquivo não gravado.');
  return linha.id;
}

// `null` quando a arte não existe na empresa.
export async function obterArte(
  db: Banco | Transacao,
  empresaId: string,
  arteId: string,
): Promise<Arte | null> {
  const [arte] = await db
    .select()
    .from(artes)
    .where(and(eq(artes.id, arteId), eq(artes.empresaId, empresaId)));
  if (!arte) return null;

  const ids = [arte.pdfId, arte.imagemId].filter((id): id is string => id !== null);
  // Só os metadados: o conteúdo (bytea) nunca é carregado aqui.
  const metadados = ids.length
    ? await db
        .select({
          id: arquivos.id,
          nomeOriginal: arquivos.nomeOriginal,
          tipoMime: arquivos.tipoMime,
          tamanho: arquivos.tamanho,
        })
        .from(arquivos)
        .where(inArray(arquivos.id, ids))
    : [];
  const arquivoDe = (id: string | null) => {
    const meta = metadados.find((m) => m.id === id);
    return meta
      ? { nomeOriginal: meta.nomeOriginal, tipoMime: meta.tipoMime, tamanho: meta.tamanho }
      : null;
  };
  const maquinaIds = await db
    .select({ id: arteMaquinas.maquinaId })
    .from(arteMaquinas)
    .where(eq(arteMaquinas.arteId, arte.id))
    .orderBy(asc(arteMaquinas.maquinaId));

  return {
    id: arte.id,
    clienteId: arte.clienteId,
    produtoId: arte.produtoId,
    nome: arte.nome,
    corId: arte.corId,
    maquinaIds: maquinaIds.map((m) => m.id),
    pdf: arquivoDe(arte.pdfId),
    imagem: arquivoDe(arte.imagemId),
  };
}

export async function criarArte(db: Banco, entrada: NovaArte): Promise<Arte> {
  if (!entrada.pdf && !entrada.imagem) throw invalida('Envie ao menos um arquivo.');
  const nome = nomeOuPadrao(entrada.nome);
  const maquinaIds = [...new Set(entrada.maquinaIds)];

  try {
    const arteId = await db.transaction(async (tx) => {
      await conferirReferencias(tx, entrada.empresaId, { ...entrada, maquinaIds });
      const pdfId = entrada.pdf ? await gravarArquivo(tx, entrada.pdf) : null;
      const imagemId = entrada.imagem ? await gravarArquivo(tx, entrada.imagem) : null;
      const [arte] = await tx
        .insert(artes)
        .values({
          empresaId: entrada.empresaId,
          clienteId: entrada.clienteId,
          produtoId: entrada.produtoId,
          nome,
          corId: entrada.corId,
          pdfId,
          imagemId,
          criadoPor: entrada.usuarioId,
          atualizadoPor: entrada.usuarioId,
        })
        .returning({ id: artes.id });
      if (!arte) throw new Error('Arte não criada.');
      await tx
        .insert(arteMaquinas)
        .values(maquinaIds.map((maquinaId) => ({ arteId: arte.id, maquinaId })));
      return arte.id;
    });
    const criada = await obterArte(db, entrada.empresaId, arteId);
    if (!criada) throw new Error('Arte não criada.');
    return criada;
  } catch (erro) {
    if (violouUnico(erro)) throw duplicada(nome);
    throw erro;
  }
}

// `null` quando a arte não existe na empresa.
export async function atualizarArte(db: Banco, entrada: EdicaoArte): Promise<Arte | null> {
  let nomeFinal = entrada.nome === undefined ? undefined : nomeOuPadrao(entrada.nome);
  try {
    const encontrada = await db.transaction(async (tx) => {
      const [atual] = await tx
        .select()
        .from(artes)
        .where(and(eq(artes.id, entrada.arteId), eq(artes.empresaId, entrada.empresaId)))
        .for('update');
      if (!atual) return false;
      nomeFinal ??= atual.nome;

      const manterPdf = Boolean(entrada.pdf) || (atual.pdfId !== null && !entrada.removerPdf);
      const manterImagem =
        Boolean(entrada.imagem) || (atual.imagemId !== null && !entrada.removerImagem);
      if (!manterPdf && !manterImagem) throw invalida('A arte precisa ter ao menos um arquivo.');

      await conferirReferencias(tx, entrada.empresaId, entrada);

      // Os arquivos antigos só saem depois de a arte deixar de referenciá-los (FK).
      const descartar: string[] = [];
      let pdfId = atual.pdfId;
      if (entrada.pdf) {
        if (pdfId) descartar.push(pdfId);
        pdfId = await gravarArquivo(tx, entrada.pdf);
      } else if (entrada.removerPdf && pdfId) {
        descartar.push(pdfId);
        pdfId = null;
      }
      let imagemId = atual.imagemId;
      if (entrada.imagem) {
        if (imagemId) descartar.push(imagemId);
        imagemId = await gravarArquivo(tx, entrada.imagem);
      } else if (entrada.removerImagem && imagemId) {
        descartar.push(imagemId);
        imagemId = null;
      }

      await tx
        .update(artes)
        .set({
          produtoId: entrada.produtoId ?? atual.produtoId,
          nome: nomeFinal,
          corId: entrada.corId ?? atual.corId,
          pdfId,
          imagemId,
          atualizadoPor: entrada.usuarioId,
          atualizadoEm: sql`now()`,
        })
        .where(eq(artes.id, atual.id));
      if (descartar.length) await tx.delete(arquivos).where(inArray(arquivos.id, descartar));

      if (entrada.maquinaIds) {
        await tx.delete(arteMaquinas).where(eq(arteMaquinas.arteId, atual.id));
        await tx
          .insert(arteMaquinas)
          .values(
            [...new Set(entrada.maquinaIds)].map((maquinaId) => ({ arteId: atual.id, maquinaId })),
          );
      }
      return true;
    });
    return encontrada ? obterArte(db, entrada.empresaId, entrada.arteId) : null;
  } catch (erro) {
    if (violouUnico(erro)) throw duplicada(nomeFinal ?? '');
    throw erro;
  }
}

// Remove a arte e seus arquivos numa transação; `false` quando a arte não existe na empresa.
export async function removerArte(db: Banco, empresaId: string, arteId: string): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [arte] = await tx
      .delete(artes)
      .where(and(eq(artes.id, arteId), eq(artes.empresaId, empresaId)))
      .returning({ pdfId: artes.pdfId, imagemId: artes.imagemId });
    if (!arte) return false;
    const ids = [arte.pdfId, arte.imagemId].filter((id): id is string => id !== null);
    if (ids.length) await tx.delete(arquivos).where(inArray(arquivos.id, ids));
    return true;
  });
}
