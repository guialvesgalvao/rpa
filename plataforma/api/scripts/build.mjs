// Compila a API para dist/ (servidor.mjs e migrar.mjs). Os contratos são embutidos; os pacotes npm ficam no node_modules.
import { readFile } from 'node:fs/promises';
import { fileURLToPath, URL } from 'node:url';
import { build } from 'esbuild';

const raiz = fileURLToPath(new URL('..', import.meta.url));
const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const externos = Object.keys(pkg.dependencies).filter((nome) => nome !== '@plataforma/contratos');

await build({
  absWorkingDir: raiz,
  entryPoints: { servidor: 'src/servidor.ts', migrar: 'src/db/migrar.ts' },
  outdir: 'dist',
  outExtension: { '.js': '.mjs' },
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'esm',
  sourcemap: true,
  logLevel: 'info',
  external: externos,
});
