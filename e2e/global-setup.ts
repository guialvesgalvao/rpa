import { execSync } from 'node:child_process';

import { RAIZ, URL_API, URL_BANCO, URL_SITE, exigirLocal } from './apoio/ambiente.js';

// O banco é preparado no comando do servidor da API (antes de ela subir); aqui, só o build do app.
export default function globalSetup(): void {
  for (const url of [URL_API, URL_SITE, URL_BANCO]) exigirLocal(url);
  execSync('npm run app:build', { cwd: RAIZ, stdio: 'inherit' });
}
