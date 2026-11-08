import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { gerarCnpj, PDF_MINIMO } from '../../src/cli/semear-dev.js';
import {
  arquivos,
  artes,
  clientes,
  cores,
  empresas,
  produtos,
  tarefasArte,
  tarefasArteComentarios,
  tarefasArteHistorico,
} from '../../src/db/esquema.js';
import { codigoDoErro, criarBancoTeste, limparTabelas } from '../helpers/banco.js';

const VIOLA_CHECK = '23514';
const VIOLA_FK = '23503';
const VIOLA_RESTRICT = '23001';

const { db, fechar } = criarBancoTeste();
afterAll(() => fechar());
beforeEach(() => limparTabelas(db));

async function empresaId(slug: string) {
  const [linha] = await db.select().from(empresas).where(eq(empresas.slug, slug));
  if (!linha) throw new Error(`empresa ${slug} não semeada`);
  return linha.id;
}

// Dados sintéticos: um cliente e um produto por empresa.
async function cenario(slug: string, numero: number) {
  const empresa = await empresaId(slug);
  const [cliente] = await db
    .insert(clientes)
    .values({ empresaId: empresa, razaoSocial: 'Cliente Fictício Ltda', cnpj: gerarCnpj(numero) })
    .returning();
  const [produto] = await db
    .insert(produtos)
    .values({ empresaId: empresa, nome: `Caixa Ficticia ${numero}` })
    .returning();
  if (!cliente || !produto) throw new Error('cenário não criado');
  return { empresa, clienteId: cliente.id, produtoId: produto.id };
}

describe('tarefas_arte', () => {
  it('nasce como nao_iniciada', async () => {
    const c = await cenario('aba', 1);
    const [tarefa] = await db
      .insert(tarefasArte)
      .values({ empresaId: c.empresa, clienteId: c.clienteId, produtoId: c.produtoId })
      .returning();
    expect(tarefa?.status).toBe('nao_iniciada');
  });

  it('recusa status fora da lista', async () => {
    const c = await cenario('aba', 2);
    const insercao = db.insert(tarefasArte).values({
      empresaId: c.empresa,
      clienteId: c.clienteId,
      produtoId: c.produtoId,
      status: 'x',
    });
    expect(await codigoDoErro(insercao)).toBe(VIOLA_CHECK);
  });

  it('recusa concluída sem arte e aceita com arte', async () => {
    const c = await cenario('aba', 3);
    const semArte = db.insert(tarefasArte).values({
      empresaId: c.empresa,
      clienteId: c.clienteId,
      produtoId: c.produtoId,
      status: 'concluida',
    });
    expect(await codigoDoErro(semArte)).toBe(VIOLA_CHECK);

    const [arquivo] = await db
      .insert(arquivos)
      .values({
        nomeOriginal: 'arte.pdf',
        tipoMime: 'application/pdf',
        tamanho: PDF_MINIMO.length,
        sha256: 'a'.repeat(64),
        conteudo: PDF_MINIMO,
      })
      .returning();
    const [cor] = await db.select().from(cores).limit(1);
    const [arte] = await db
      .insert(artes)
      .values({
        empresaId: c.empresa,
        clienteId: c.clienteId,
        produtoId: c.produtoId,
        corId: cor!.id,
        pdfId: arquivo!.id,
      })
      .returning();
    const [tarefa] = await db
      .insert(tarefasArte)
      .values({
        empresaId: c.empresa,
        clienteId: c.clienteId,
        produtoId: c.produtoId,
        status: 'concluida',
        arteId: arte!.id,
      })
      .returning();
    expect(tarefa?.arteId).toBe(arte!.id);
    // A arte da tarefa não pode ser removida.
    expect(await codigoDoErro(db.delete(artes).where(eq(artes.id, arte!.id)))).toBe(VIOLA_RESTRICT);
  });

  it('recusa cliente ou produto de outra empresa', async () => {
    const aba = await cenario('aba', 4);
    const roma = await cenario('roma', 5);
    for (const valores of [
      { empresaId: aba.empresa, clienteId: roma.clienteId, produtoId: aba.produtoId },
      { empresaId: aba.empresa, clienteId: aba.clienteId, produtoId: roma.produtoId },
    ]) {
      expect(await codigoDoErro(db.insert(tarefasArte).values(valores))).toBe(VIOLA_FK);
    }
  });
});

describe('comentários e histórico', () => {
  async function tarefa() {
    const c = await cenario('aba', 6);
    const [linha] = await db
      .insert(tarefasArte)
      .values({ empresaId: c.empresa, clienteId: c.clienteId, produtoId: c.produtoId })
      .returning();
    return linha!.id;
  }

  it('recusa comentário longo demais; vazio é aceito (só anexo, regra da API)', async () => {
    const tarefaId = await tarefa();
    const longo = db.insert(tarefasArteComentarios).values({ tarefaId, texto: 'x'.repeat(2001) });
    expect(await codigoDoErro(longo)).toBe(VIOLA_CHECK);
    const vazio = db.insert(tarefasArteComentarios).values({ tarefaId, texto: '' });
    expect(await codigoDoErro(vazio)).toBeUndefined();
  });

  it('recusa status inválido no histórico e aceita a criação sem status anterior', async () => {
    const tarefaId = await tarefa();
    const invalido = db
      .insert(tarefasArteHistorico)
      .values({ tarefaId, statusAnterior: 'x', statusNovo: 'em_desenvolvimento' });
    expect(await codigoDoErro(invalido)).toBe(VIOLA_CHECK);
    const [criacao] = await db
      .insert(tarefasArteHistorico)
      .values({ tarefaId, statusNovo: 'nao_iniciada' })
      .returning();
    expect(criacao?.statusAnterior).toBeNull();
  });

  it('some com a tarefa', async () => {
    const tarefaId = await tarefa();
    await db.insert(tarefasArteComentarios).values({ tarefaId, texto: 'ok' });
    await db.insert(tarefasArteHistorico).values({ tarefaId, statusNovo: 'nao_iniciada' });
    await db.delete(tarefasArte).where(eq(tarefasArte.id, tarefaId));
    expect(await db.select().from(tarefasArteComentarios)).toEqual([]);
    expect(await db.select().from(tarefasArteHistorico)).toEqual([]);
  });
});
