import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { z } from 'zod';

// Aplica as migrações pendentes de `pasta` (padrão: `drizzle/` do diretório atual, a pasta da api).
export async function migrar(url: string, pasta = path.resolve('drizzle')): Promise<void> {
  const conexao = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await migrate(drizzle(conexao), { migrationsFolder: pasta });
  } finally {
    await conexao.end();
  }
}

// Execução direta (`npm run db:migrar`): o npm roda o script com a pasta da api como diretório atual.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const url = z.string().min(1, 'DATABASE_URL ausente').parse(process.env.DATABASE_URL);
  await migrar(url);
  console.log('Migrações aplicadas.');
}
