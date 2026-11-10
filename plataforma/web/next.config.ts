import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';

// A raiz é `plataforma/` (workspaces e lockfile próprios), não a raiz do repositório.
const raiz = fileURLToPath(new URL('..', import.meta.url));

const config: NextConfig = {
  // A suíte E2E local (raiz: `npm run e2e`) usa uma pasta própria, para conviver com o `next dev` de sempre.
  distDir: process.env.NEXT_DIST_DIR || '.next',
  transpilePackages: ['@plataforma/contratos'],
  outputFileTracingRoot: raiz,
  turbopack: { root: raiz },
};

export default config;
