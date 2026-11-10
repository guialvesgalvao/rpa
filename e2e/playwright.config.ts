import { defineConfig, devices } from '@playwright/test';

import { ENV_API, RAIZ, URL_API, URL_SITE } from './apoio/ambiente.js';

// Suíte E2E local (ADR 0010): site + app contra a API e o banco locais da suíte; nunca o Bling.
const PLATAFORMA_API = 'npm --prefix plataforma -w @plataforma/api run';

export default defineConfig({
  testDir: '.',
  outputDir: '../test-results/e2e',
  reporter: [['list'], ['html', { outputFolder: '../playwright-report', open: 'never' }]],
  // Os cenários compartilham o banco e o app tem uma janela por vez.
  workers: 1,
  fullyParallel: false,
  forbidOnly: true,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  globalSetup: './global-setup.ts',
  use: {
    locale: 'pt-BR',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: [
    {
      name: 'api',
      // Sobe o Postgres, recria o banco `rpa_e2e` e só então a API (sem o .env local).
      command: `docker compose -f plataforma/docker-compose.yml up -d --wait && ${PLATAFORMA_API} e2e:banco -- preparar && ${PLATAFORMA_API} e2e:servidor`,
      cwd: RAIZ,
      url: `${URL_API}/v1/saude`,
      env: ENV_API,
      reuseExistingServer: false,
      timeout: 180_000,
      stdout: 'ignore',
      stderr: 'pipe',
    },
    {
      name: 'site',
      command: 'npx next dev --port 3100',
      cwd: `${RAIZ}/plataforma/web`,
      url: `${URL_SITE}/api/saude`,
      env: { API_URL_INTERNA: URL_API, SITE_URL: URL_SITE, NEXT_DIST_DIR: '.next-e2e' },
      reuseExistingServer: false,
      timeout: 180_000,
      stdout: 'ignore',
      stderr: 'pipe',
    },
  ],
  projects: [
    { name: 'preparo', testMatch: 'site/**/*.setup.ts', use: { baseURL: URL_SITE } },
    {
      name: 'site',
      testMatch: 'site/**/*.spec.ts',
      dependencies: ['preparo'],
      use: { ...devices['Desktop Chrome'], baseURL: URL_SITE },
    },
    { name: 'app', testMatch: 'app/**/*.spec.ts' },
  ],
});
