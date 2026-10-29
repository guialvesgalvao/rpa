import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    globalSetup: ['tests/setup-global.ts'],
    // Os testes de integração compartilham o mesmo banco.
    fileParallelism: false,
    // Cada login passa por um scrypt (~0,3 s); os testes do limite de tentativas fazem vários.
    testTimeout: 15_000,
  },
});
