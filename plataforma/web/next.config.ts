import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';

// A raiz é `plataforma/` (workspaces e lockfile próprios), não a raiz do repositório.
const raiz = fileURLToPath(new URL('..', import.meta.url));

const config: NextConfig = {
  transpilePackages: ['@plataforma/contratos'],
  outputFileTracingRoot: raiz,
  turbopack: { root: raiz },
};

export default config;
