import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    globalSetup: ['tests/setup-global.ts'],
    // Os testes de integração compartilham o mesmo banco.
    fileParallelism: false,
  },
});
