// Compila o app Electron (src/app) para dist/app, junto com o HTML e os assets.
import { cp } from 'node:fs/promises';
import process from 'node:process';
import { build } from 'esbuild';

const common = { bundle: true, sourcemap: true, logLevel: 'info' };

// URL da API da plataforma, embutida no processo principal. O release (GitHub Actions) exige a variável;
// em desenvolvimento, sem ela, vale a API local.
const apiUrl =
  process.env.RPA_API_URL || (process.env.GITHUB_ACTIONS ? '' : 'http://localhost:3001');
if (!apiUrl) throw new Error('RPA_API_URL é obrigatória no build de release.');

await Promise.all([
  // Processo principal: dependências ficam em node_modules (Playwright, pino etc.).
  build({
    ...common,
    entryPoints: ['src/app/main.ts'],
    outfile: 'dist/app/main.mjs',
    platform: 'node',
    format: 'esm',
    packages: 'external',
    define: { __RPA_API_URL__: JSON.stringify(apiUrl) },
  }),
  // Preload com sandbox precisa ser CommonJS.
  build({
    ...common,
    entryPoints: ['src/app/preload.ts'],
    outfile: 'dist/app/preload.cjs',
    platform: 'node',
    format: 'cjs',
    external: ['electron'],
  }),
  build({
    ...common,
    entryPoints: ['src/app/renderer.ts'],
    outfile: 'dist/app/renderer.js',
    platform: 'browser',
    format: 'iife',
  }),
]);
await Promise.all([
  cp('src/app/index.html', 'dist/app/index.html'),
  cp('src/app/assets', 'dist/app/assets', { recursive: true }),
]);
