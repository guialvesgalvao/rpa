import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import * as esquema from './esquema.js';

export function criarBanco(url: string) {
  const conexao = postgres(url, { onnotice: () => {} });
  const db = drizzle(conexao, { schema: esquema });
  return { db, fechar: () => conexao.end() };
}

export type Banco = ReturnType<typeof criarBanco>['db'];
