import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // Fora do Next, `server-only` lança ao ser importado; nos testes ele vira um módulo vazio.
    alias: { 'server-only': fileURLToPath(new URL('tests/apoio/vazio.ts', import.meta.url)) },
  },
});
