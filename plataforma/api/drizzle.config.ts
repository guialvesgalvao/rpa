import { defineConfig } from 'drizzle-kit';

// Só gera as migrações a partir do esquema; não conecta no banco.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/esquema.ts',
  out: './drizzle',
});
