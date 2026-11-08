import type { Readable } from 'node:stream';

import { eq } from 'drizzle-orm';

import type { Banco } from '../db/cliente.js';
import { arquivos } from '../db/esquema.js';
import type { ArmazemArquivos } from './armazem.js';

export type ConteudoArquivo = {
  nomeOriginal: string;
  tipoMime: string;
  tamanho: number;
  // Buffer quando o conteúdo está na linha (bytea); stream quando vem do bucket.
  corpo: Buffer | Readable;
};

// Conteúdo de um arquivo, de onde ele estiver (linha antiga em bytea ou objeto no bucket). `null` se a linha
// não existe.
export async function lerArquivo(
  db: Banco,
  armazem: ArmazemArquivos,
  arquivoId: string,
): Promise<ConteudoArquivo | null> {
  const [linha] = await db
    .select({
      nomeOriginal: arquivos.nomeOriginal,
      tipoMime: arquivos.tipoMime,
      tamanho: arquivos.tamanho,
      conteudo: arquivos.conteudo,
      chaveObjeto: arquivos.chaveObjeto,
    })
    .from(arquivos)
    .where(eq(arquivos.id, arquivoId));
  if (!linha) return null;
  const { nomeOriginal, tipoMime, tamanho } = linha;
  if (linha.conteudo) return { nomeOriginal, tipoMime, tamanho, corpo: linha.conteudo };
  if (!linha.chaveObjeto) return null;
  return { nomeOriginal, tipoMime, tamanho, corpo: await armazem.ler(linha.chaveObjeto) };
}

// `Content-Disposition` de download: nome ASCII simples e o original em UTF-8 (RFC 6266/5987).
export function disposicaoAnexo(nome: string): string {
  const ascii = nome.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_') || 'arquivo';
  const utf8 = encodeURIComponent(nome).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16)}`,
  );
  return `attachment; filename="${ascii}"; filename*=UTF-8''${utf8}`;
}
