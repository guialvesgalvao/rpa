import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';

import { eq, isNull } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import type { ArmazemArquivos } from '../../src/arquivos/armazem.js';
import { ARMAZEM_BANCO } from '../../src/arquivos/banco.js';
import { lerArquivo } from '../../src/arquivos/repositorio.js';
import { migrarArquivos } from '../../src/cli/migrar-arquivos.js';
import { PDF_MINIMO, PNG_1X1 } from '../../src/cli/semear-dev.js';
import { arquivos } from '../../src/db/esquema.js';
import { criarBancoTeste, limparTabelas } from '../helpers/banco.js';
import { chavesNoBucket, criarArmazemTeste, limparBucket } from '../helpers/s3.js';

// Dados sintéticos.
const { db, fechar } = criarBancoTeste();
const armazem = criarArmazemTeste();
afterAll(() => fechar());

async function gravarNoBanco(nome: string, conteudo: Buffer): Promise<string> {
  const [linha] = await db
    .insert(arquivos)
    .values({
      nomeOriginal: nome,
      tipoMime: 'application/octet-stream',
      tamanho: conteudo.length,
      sha256: createHash('sha256').update(conteudo).digest('hex'),
      conteudo,
    })
    .returning({ id: arquivos.id });
  return linha!.id;
}

async function lerTudo(corpo: Buffer | Readable): Promise<Buffer> {
  if (Buffer.isBuffer(corpo)) return corpo;
  const partes: Buffer[] = [];
  for await (const parte of corpo) partes.push(Buffer.from(parte as Uint8Array));
  return Buffer.concat(partes);
}

beforeEach(async () => {
  await limparTabelas(db);
  await limparBucket(armazem);
});

describe('migrarArquivos', () => {
  it('move o conteúdo para o bucket, confere e zera a coluna; repetir não faz nada', async () => {
    const conteudos = [PDF_MINIMO, PNG_1X1, Buffer.from('arquivo ficticio 3')];
    const ids = [];
    for (const [i, conteudo] of conteudos.entries()) {
      ids.push(await gravarNoBanco(`arquivo-${i}`, conteudo));
    }

    expect(await migrarArquivos(db, armazem, { lote: 2 })).toEqual({
      migrados: 3,
      falhas: 0,
      restantes: 0,
    });
    const linhas = await db.select().from(arquivos);
    for (const linha of linhas) {
      expect(linha.conteudo).toBeNull();
      expect(linha.chaveObjeto).not.toBeNull();
    }
    expect(await chavesNoBucket(armazem)).toHaveLength(3);
    for (const [i, id] of ids.entries()) {
      const lido = await lerArquivo(db, armazem, id);
      expect((await lerTudo(lido!.corpo)).equals(conteudos[i]!)).toBe(true);
    }

    expect(await migrarArquivos(db, armazem)).toEqual({ migrados: 0, falhas: 0, restantes: 0 });
    expect(await chavesNoBucket(armazem)).toHaveLength(3);
  });

  it('falha no meio: a linha fica intacta, as outras seguem; a próxima execução termina', async () => {
    for (const nome of ['a', 'b', 'c']) await gravarNoBanco(nome, Buffer.from(`${nome} ficticio`));
    let gravacoes = 0;
    const instavel: ArmazemArquivos = {
      ...armazem,
      externo: true,
      async gravar(chave, dados, tipo) {
        gravacoes++;
        if (gravacoes === 2) throw new Error('rede caiu');
        await armazem.gravar(chave, dados, tipo);
      },
    };

    expect(await migrarArquivos(db, instavel)).toEqual({ migrados: 2, falhas: 1, restantes: 1 });
    const intactas = await db.select().from(arquivos).where(isNull(arquivos.chaveObjeto));
    expect(intactas).toHaveLength(1);
    expect(intactas[0]?.conteudo?.toString()).toBe(`${intactas[0]?.nomeOriginal} ficticio`);

    expect(await migrarArquivos(db, armazem)).toEqual({ migrados: 1, falhas: 0, restantes: 0 });
    expect(await chavesNoBucket(armazem)).toHaveLength(3);
  });

  it('objeto que não confere ao ler de volta: apagado, linha intacta', async () => {
    const id = await gravarNoBanco('a', Buffer.from('original ficticio'));
    const corrompido: ArmazemArquivos = {
      ...armazem,
      externo: true,
      gravar: (chave, dados, tipo) => armazem.gravar(chave, dados, tipo),
      ler: async () => Readable.from([Buffer.from('outro conteudo')]),
      apagar: (chave) => armazem.apagar(chave),
    };

    expect(await migrarArquivos(db, corrompido)).toEqual({ migrados: 0, falhas: 1, restantes: 1 });
    const [linha] = await db.select().from(arquivos).where(eq(arquivos.id, id));
    expect(linha?.conteudo?.toString()).toBe('original ficticio');
    expect(await chavesNoBucket(armazem)).toEqual([]);
  });

  it('sem bucket configurado: recusa', async () => {
    await expect(migrarArquivos(db, ARMAZEM_BANCO)).rejects.toThrow(/ARQUIVOS_S3/);
  });
});
