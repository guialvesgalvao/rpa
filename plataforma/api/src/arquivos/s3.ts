import { Readable } from 'node:stream';

import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';

import type { ArmazemArquivos } from './armazem.js';

export type ConfigS3 = {
  endpoint: string;
  regiao: string;
  bucket: string;
  chave: string;
  segredo: string;
  // `true`: URL no estilo `endpoint/bucket/chave` (S3Mock local); `false`: `bucket.endpoint/chave`.
  estiloCaminho: boolean;
};

// Bucket privado compatível com S3 (Railway Storage Bucket; S3Mock no desenvolvimento). A API é a porta de
// entrada: upload e download passam por ela, sem URL pré-assinada.
export function criarArmazemS3(config: ConfigS3): ArmazemArquivos & { cliente: S3Client } {
  const cliente = new S3Client({
    endpoint: config.endpoint,
    region: config.regiao,
    forcePathStyle: config.estiloCaminho,
    credentials: { accessKeyId: config.chave, secretAccessKey: config.segredo },
  });
  const Bucket = config.bucket;

  return {
    externo: true,
    cliente,
    async gravar(chave, dados, tipoMime) {
      await cliente.send(
        new PutObjectCommand({ Bucket, Key: chave, Body: dados, ContentType: tipoMime }),
      );
    },
    async ler(chave) {
      const resposta = await cliente.send(new GetObjectCommand({ Bucket, Key: chave }));
      if (!(resposta.Body instanceof Readable)) throw new Error('Objeto sem conteúdo legível.');
      return resposta.Body;
    },
    async apagar(chave) {
      await cliente.send(new DeleteObjectCommand({ Bucket, Key: chave }));
    },
  };
}
