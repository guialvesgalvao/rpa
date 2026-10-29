import postgres from 'postgres';

import { migrar } from '../src/db/migrar.js';
import { urlBancoTeste } from './helpers/banco.js';

// Recria o banco de teste do zero e aplica as migrações, uma vez por execução.
export default async function setup(): Promise<void> {
  const url = urlBancoTeste();
  const conexao = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await conexao`DROP SCHEMA IF EXISTS drizzle CASCADE`;
    await conexao`DROP SCHEMA public CASCADE`;
    await conexao`CREATE SCHEMA public`;
  } finally {
    await conexao.end();
  }
  await migrar(url);
}
