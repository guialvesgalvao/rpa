import { mkdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { DadosSincronizacao } from './sincronizacao.js';

export type DadosArmazenados = DadosSincronizacao & { empresa: string; sincronizadoEm: string };

// Destino dos dados lidos do Bling. Hoje um JSON local; depois, o Postgres.
export interface ArmazemSincronizacao {
  salvar(empresa: string, dados: DadosSincronizacao, sincronizadoEm: Date): Promise<void>;
}

const SLUG = /^[a-z0-9_-]+$/;

// `<dir>/<empresa>.json`, gravado num `.tmp` e renomeado: quem lê nunca vê um arquivo pela metade.
export function criarArmazemArquivo(dir: string): ArmazemSincronizacao {
  const pasta = path.resolve(dir);
  return {
    async salvar(empresa, dados, sincronizadoEm) {
      // O slug vira nome de arquivo: nada de `..` ou separadores.
      if (!SLUG.test(empresa)) throw new Error('Slug de empresa inválido para o arquivo.');
      await mkdir(pasta, { recursive: true });
      const destino = path.join(pasta, `${empresa}.json`);
      const temporario = `${destino}.tmp`;
      const conteudo: DadosArmazenados = {
        empresa,
        sincronizadoEm: sincronizadoEm.toISOString(),
        ...dados,
      };
      await writeFile(temporario, `${JSON.stringify(conteudo, null, 2)}\n`, 'utf8');
      await rename(temporario, destino);
    },
  };
}
