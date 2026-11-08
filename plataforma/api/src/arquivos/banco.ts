import type { ArmazemArquivos } from './armazem.js';

const semBucket = () =>
  Promise.reject(new Error('Sem bucket configurado: o conteúdo fica no banco.'));

// Sem bucket (desenvolvimento sem S3 e produção antes da migração): o conteúdo vai na linha de `arquivos`
// (bytea). Não há objeto a gravar, ler ou apagar.
export const ARMAZEM_BANCO: ArmazemArquivos = {
  externo: false,
  gravar: semBucket,
  ler: semBucket,
  apagar: async () => {},
};
