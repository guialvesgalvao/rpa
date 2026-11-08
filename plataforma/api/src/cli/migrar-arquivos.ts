import { createHash } from 'node:crypto';
import type { Readable } from 'node:stream';
import { pathToFileURL } from 'node:url';

import { and, asc, eq, gt, isNotNull, isNull } from 'drizzle-orm';

import { type ArmazemArquivos, novaChave } from '../arquivos/armazem.js';
import { criarArmazemS3 } from '../arquivos/s3.js';
import { lerConfigS3 } from '../config.js';
import { type Banco, criarBanco } from '../db/cliente.js';
import { arquivos } from '../db/esquema.js';

export type ResultadoMigracao = { migrados: number; falhas: number; restantes: number };

async function lerTudo(corpo: Readable): Promise<Buffer> {
  const partes: Buffer[] = [];
  for await (const parte of corpo) partes.push(Buffer.from(parte as Uint8Array));
  return Buffer.concat(partes);
}

const sha256 = (dados: Buffer) => createHash('sha256').update(dados).digest('hex');

async function apagarSemFalhar(armazem: ArmazemArquivos, chave: string): Promise<void> {
  try {
    await armazem.apagar(chave);
  } catch {
    // Objeto órfão: a linha continua com o conteúdo e a próxima execução grava outro.
  }
}

// Copia o conteúdo bytea de cada arquivo para o bucket, em lotes. Para cada linha: grava o objeto, lê de volta e
// confere tamanho e sha256; só então, numa transação, grava a chave e zera o conteúdo. Idempotente (linhas já
// migradas ficam de fora); uma falha deixa a linha como estava e segue para a próxima. O log só tem contagens.
export async function migrarArquivos(
  db: Banco,
  armazem: ArmazemArquivos,
  { lote = 20, aoProgredir }: { lote?: number; aoProgredir?: (r: ResultadoMigracao) => void } = {},
): Promise<ResultadoMigracao> {
  if (!armazem.externo) throw new Error('Configure o bucket (ARQUIVOS_S3_*) antes de migrar.');
  const resultado: ResultadoMigracao = { migrados: 0, falhas: 0, restantes: 0 };
  let ultimoId: string | undefined;

  for (;;) {
    const linhas = await db
      .select({
        id: arquivos.id,
        tipoMime: arquivos.tipoMime,
        tamanho: arquivos.tamanho,
        sha256: arquivos.sha256,
        conteudo: arquivos.conteudo,
      })
      .from(arquivos)
      .where(
        and(
          isNotNull(arquivos.conteudo),
          isNull(arquivos.chaveObjeto),
          ultimoId ? gt(arquivos.id, ultimoId) : undefined,
        ),
      )
      .orderBy(asc(arquivos.id))
      .limit(lote);
    if (linhas.length === 0) break;

    for (const linha of linhas) {
      ultimoId = linha.id;
      const conteudo = linha.conteudo;
      if (!conteudo) continue;
      const chave = novaChave();
      try {
        await armazem.gravar(chave, conteudo, linha.tipoMime);
        const devolvido = await lerTudo(await armazem.ler(chave));
        if (devolvido.length !== linha.tamanho || sha256(devolvido) !== linha.sha256) {
          throw new Error('O objeto gravado não confere com o banco.');
        }
        const atualizadas = await db.transaction((tx) =>
          tx
            .update(arquivos)
            .set({ chaveObjeto: chave, conteudo: null })
            .where(and(eq(arquivos.id, linha.id), isNull(arquivos.chaveObjeto)))
            .returning({ id: arquivos.id }),
        );
        if (atualizadas.length === 0) {
          // Removida ou migrada por outra execução no meio do caminho.
          await apagarSemFalhar(armazem, chave);
          continue;
        }
        resultado.migrados++;
      } catch {
        await apagarSemFalhar(armazem, chave);
        resultado.falhas++;
      }
    }
    aoProgredir?.({ ...resultado });
  }

  resultado.restantes = await db.$count(
    arquivos,
    and(isNotNull(arquivos.conteudo), isNull(arquivos.chaveObjeto)),
  );
  return resultado;
}

async function main(): Promise<number> {
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  if (!url) {
    console.error('Defina DATABASE_PUBLIC_URL ou DATABASE_URL.');
    return 1;
  }
  const s3 = lerConfigS3();
  if (!s3) {
    console.error('Defina as variáveis ARQUIVOS_S3_* do bucket.');
    return 1;
  }
  const { db, fechar } = criarBanco(url);
  try {
    const resultado = await migrarArquivos(db, criarArmazemS3(s3), {
      aoProgredir: (r) => console.log(`Migrados: ${r.migrados} · falhas: ${r.falhas}`),
    });
    console.log(
      `Concluído. Migrados: ${resultado.migrados} · falhas: ${resultado.falhas} · ainda no banco: ${resultado.restantes}`,
    );
    return resultado.falhas > 0 ? 1 : 0;
  } finally {
    await fechar();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main();
}
