import { createHash } from 'node:crypto';

import type { Banco } from '../db/cliente.js';
import { arquivos } from '../db/esquema.js';
import type { ArquivoRecebido } from './armazem.js';

type Transacao = Parameters<Parameters<Banco['transaction']>[0]>[0];

// Grava os metadados do arquivo (e o conteúdo, sem bucket) e devolve o id. Com `chaveObjeto` (já gravado no bucket
// por `comObjetosGravados`), a linha guarda só a chave.
export async function gravarArquivo(tx: Transacao, arquivo: ArquivoRecebido): Promise<string> {
  const [linha] = await tx
    .insert(arquivos)
    .values({
      nomeOriginal: arquivo.nomeOriginal,
      tipoMime: arquivo.tipoMime,
      tamanho: arquivo.conteudo.length,
      sha256: createHash('sha256').update(arquivo.conteudo).digest('hex'),
      conteudo: arquivo.chaveObjeto ? null : arquivo.conteudo,
      chaveObjeto: arquivo.chaveObjeto ?? null,
    })
    .returning({ id: arquivos.id });
  if (!linha) throw new Error('Arquivo não gravado.');
  return linha.id;
}
