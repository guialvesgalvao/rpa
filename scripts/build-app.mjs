// Compila o app Electron (src/app) para dist/app, junto com o HTML e os assets.
import { cp } from 'node:fs/promises';
import { build } from 'esbuild';

const common = { bundle: true, sourcemap: true, logLevel: 'info' };

await Promise.all([
  // Processo principal: dependências ficam em node_modules (Playwright, pino etc.).
  build({
    ...common,
    entryPoints: ['src/app/main.ts'],
    outfile: 'dist/app/main.mjs',
    platform: 'node',
    format: 'esm',
    packages: 'external',
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
