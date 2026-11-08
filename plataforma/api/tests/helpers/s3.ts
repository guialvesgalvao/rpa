import { ListObjectsV2Command } from '@aws-sdk/client-s3';

import { criarArmazemS3 } from '../../src/arquivos/s3.js';

// S3 local dos testes (S3Mock do docker-compose; no CI, o mesmo container). Aceita qualquer credencial.
const URL_PADRAO = 'http://localhost:9090';
export const BUCKET_TESTE = 'rpa-arquivos-teste';

export const urlS3Teste = (): string => process.env.ARQUIVOS_S3_TESTE_URL || URL_PADRAO;

export function criarArmazemTeste() {
  return criarArmazemS3({
    endpoint: urlS3Teste(),
    regiao: 'us-east-1',
    bucket: BUCKET_TESTE,
    chave: 'chave-ficticia',
    segredo: 'segredo-ficticio',
    estiloCaminho: true,
  });
}

// Chaves de todos os objetos do bucket de teste.
export async function chavesNoBucket(
  armazem: ReturnType<typeof criarArmazemTeste>,
): Promise<string[]> {
  const chaves: string[] = [];
  let token: string | undefined;
  do {
    const pagina = await armazem.cliente.send(
      new ListObjectsV2Command({ Bucket: BUCKET_TESTE, ContinuationToken: token }),
    );
    for (const objeto of pagina.Contents ?? []) if (objeto.Key) chaves.push(objeto.Key);
    token = pagina.IsTruncated ? pagina.NextContinuationToken : undefined;
  } while (token);
  return chaves;
}

// Esvazia o bucket de teste entre os testes.
export async function limparBucket(armazem: ReturnType<typeof criarArmazemTeste>): Promise<void> {
  for (const chave of await chavesNoBucket(armazem)) await armazem.apagar(chave);
}
