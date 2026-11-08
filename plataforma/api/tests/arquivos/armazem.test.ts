import { createHash } from 'node:crypto';
import type { Readable } from 'node:stream';

import { EsquemaRespostaEntrar } from '@plataforma/contratos';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { criarArte, removerArte } from '../../src/artes/servico.js';
import { comObjetosGravados } from '../../src/arquivos/armazem.js';
import { ARMAZEM_BANCO } from '../../src/arquivos/banco.js';
import { disposicaoAnexo } from '../../src/arquivos/repositorio.js';
import { gerarCnpj, PDF_MINIMO, PNG_1X1 } from '../../src/cli/semear-dev.js';
import {
  arquivos,
  artes,
  clientes,
  cores,
  empresas,
  maquinas,
  produtos,
} from '../../src/db/esquema.js';
import { criarUsuario } from '../../src/usuarios/servico.js';
import { criarAppTeste } from '../helpers/app.js';
import { criarBancoTeste, limparTabelas } from '../helpers/banco.js';
import { chavesNoBucket, criarArmazemTeste, limparBucket } from '../helpers/s3.js';

// Dados sintéticos.
const { db, fechar } = criarBancoTeste();
const armazem = criarArmazemTeste();
afterAll(() => fechar());

let app: FastifyInstance;
let token: string;
let base: {
  empresaId: string;
  clienteId: string;
  produtoId: string;
  corId: string;
  maquinaId: string;
  usuarioId: string;
};

async function lerTudo(corpo: Readable): Promise<Buffer> {
  const partes: Buffer[] = [];
  for await (const parte of corpo) partes.push(Buffer.from(parte as Uint8Array));
  return Buffer.concat(partes);
}

beforeEach(async () => {
  await limparTabelas(db);
  await limparBucket(armazem);
  ({ app } = criarAppTeste(db, { armazem }));
  const admin = await criarUsuario(db, {
    email: 'adm@exemplo.com',
    nome: 'Admin Ficticio',
    perfil: 'admin',
    senha: 'senha-ficticia-123',
    empresas: ['aba'],
  });
  const login = await app.inject({
    method: 'POST',
    url: '/v1/auth/entrar',
    payload: { email: 'adm@exemplo.com', senha: 'senha-ficticia-123', origem: 'web' },
  });
  token = EsquemaRespostaEntrar.parse(login.json()).acesso;
  const [empresa] = await db.select().from(empresas).where(eq(empresas.slug, 'aba'));
  const [cliente] = await db
    .insert(clientes)
    .values({ empresaId: empresa!.id, razaoSocial: 'Pizzaria Ficticia Ltda', cnpj: gerarCnpj(11) })
    .returning();
  const [produto] = await db
    .insert(produtos)
    .values({ empresaId: empresa!.id, nome: 'Caixa Ficticia' })
    .returning();
  base = {
    empresaId: empresa!.id,
    clienteId: cliente!.id,
    produtoId: produto!.id,
    corId: (await db.select().from(cores).limit(1))[0]!.id,
    maquinaId: (await db.select().from(maquinas).limit(1))[0]!.id,
    usuarioId: admin.id,
  };
});
afterEach(() => app.close());

const novaArte = (nome = 'Padrão') => ({
  empresaId: base.empresaId,
  clienteId: base.clienteId,
  produtoId: base.produtoId,
  usuarioId: base.usuarioId,
  nome,
  corId: base.corId,
  maquinaIds: [base.maquinaId],
  pdf: { nomeOriginal: 'Arte Ficticia ção.pdf', tipoMime: 'application/pdf', conteudo: PDF_MINIMO },
  imagem: { nomeOriginal: 'arte.png', tipoMime: 'image/png', conteudo: PNG_1X1 },
});

const get = (url: string) =>
  app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${token}` } });

describe('armazém S3', () => {
  it('grava, lê e apaga um objeto; apagar o que não existe não é erro', async () => {
    await armazem.gravar('arquivos/teste-1', Buffer.from('conteudo ficticio'), 'text/plain');
    expect((await lerTudo(await armazem.ler('arquivos/teste-1'))).toString()).toBe(
      'conteudo ficticio',
    );
    await armazem.apagar('arquivos/teste-1');
    await armazem.apagar('arquivos/teste-1');
    expect(await chavesNoBucket(armazem)).toEqual([]);
  });

  it('se a transação falha, os objetos gravados antes dela saem do bucket', async () => {
    const arquivo = { nomeOriginal: 'a.png', tipoMime: 'image/png', conteudo: PNG_1X1 };
    await expect(
      comObjetosGravados(armazem, [arquivo], async () => {
        expect(await chavesNoBucket(armazem)).toHaveLength(1);
        throw new Error('falha ficticia');
      }),
    ).rejects.toThrow('falha ficticia');
    expect(await chavesNoBucket(armazem)).toEqual([]);
    expect(arquivo).not.toHaveProperty('chaveObjeto');
  });

  it('no banco (sem bucket), só executa', async () => {
    const arquivo = { nomeOriginal: 'a.png', tipoMime: 'image/png', conteudo: PNG_1X1 };
    expect(await comObjetosGravados(ARMAZEM_BANCO, [arquivo], async () => 'ok')).toBe('ok');
    expect(arquivo).not.toHaveProperty('chaveObjeto');
  });
});

describe('artes com o bucket', () => {
  it('a arte nova vai para o bucket: a linha guarda só a chave; a API serve imagem e PDF', async () => {
    const arte = await criarArte(db, novaArte(), { armazem });
    const linhas = await db.select().from(arquivos);
    expect(linhas).toHaveLength(2);
    for (const linha of linhas) {
      expect(linha.conteudo).toBeNull();
      expect(linha.chaveObjeto).toMatch(/^arquivos\/[0-9a-f-]{36}$/);
    }
    expect((await chavesNoBucket(armazem)).sort()).toEqual(linhas.map((l) => l.chaveObjeto).sort());
    const pdfLinha = linhas.find((l) => l.tipoMime === 'application/pdf');
    expect(pdfLinha?.sha256).toBe(createHash('sha256').update(PDF_MINIMO).digest('hex'));

    const imagem = await get(`/v1/empresas/aba/artes/${arte.id}/imagem`);
    expect(imagem.statusCode).toBe(200);
    expect(imagem.headers['content-type']).toBe('image/png');
    expect(imagem.rawPayload.equals(PNG_1X1)).toBe(true);

    const pdf = await get(`/v1/empresas/aba/artes/${arte.id}/pdf`);
    expect(pdf.statusCode).toBe(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect(pdf.headers['content-disposition']).toBe(disposicaoAnexo('Arte Ficticia ção.pdf'));
    expect(pdf.headers['x-content-type-options']).toBe('nosniff');
    expect(pdf.rawPayload.equals(PDF_MINIMO)).toBe(true);
  });

  it('nome repetido (falha na transação): nenhum objeto fica no bucket', async () => {
    await criarArte(db, novaArte('Repetida'), { armazem });
    const antes = await chavesNoBucket(armazem);
    await expect(criarArte(db, novaArte('Repetida'), { armazem })).rejects.toMatchObject({
      status: 409,
    });
    expect((await chavesNoBucket(armazem)).sort()).toEqual(antes.sort());
  });

  it('remover a arte apaga as linhas e depois os objetos', async () => {
    const arte = await criarArte(db, novaArte(), { armazem });
    expect(await removerArte(db, base.empresaId, arte.id, { armazem })).toBe(true);
    expect(await db.select().from(arquivos)).toEqual([]);
    expect(await chavesNoBucket(armazem)).toEqual([]);
  });

  it('a arte antiga em bytea continua legível com o bucket configurado', async () => {
    const arte = await criarArte(db, novaArte());
    const [linha] = await db.select().from(arquivos).where(eq(arquivos.tipoMime, 'image/png'));
    expect(linha?.conteudo).not.toBeNull();
    expect(await chavesNoBucket(armazem)).toEqual([]);

    const imagem = await get(`/v1/empresas/aba/artes/${arte.id}/imagem`);
    expect(imagem.statusCode).toBe(200);
    expect(imagem.rawPayload.equals(PNG_1X1)).toBe(true);
  });

  it('arte sem PDF ou de outra empresa: 404 no download do PDF', async () => {
    const semPdf = await criarArte(db, { ...novaArte('Só imagem'), pdf: undefined }, { armazem });
    const resposta = await get(`/v1/empresas/aba/artes/${semPdf.id}/pdf`);
    expect(resposta.statusCode).toBe(404);
    const [linhaArte] = await db.select().from(artes).where(eq(artes.id, semPdf.id));
    expect(linhaArte?.pdfId).toBeNull();
  });
});

describe('disposicaoAnexo', () => {
  it('nome ASCII sem aspas nem barra e o original em UTF-8', () => {
    expect(disposicaoAnexo('relatório "final".pdf')).toBe(
      `attachment; filename="relat_rio _final_.pdf"; filename*=UTF-8''relat%C3%B3rio%20%22final%22.pdf`,
    );
  });
});
