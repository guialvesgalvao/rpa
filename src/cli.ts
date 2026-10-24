import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { loadConfig } from './config/env.js';
import { createLogger } from './core/logger.js';
import type { RpaProcess } from './core/process.js';

const processesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'processes');

async function main(): Promise<number> {
  const [name, ...rest] = process.argv.slice(2);
  if (!name) {
    console.error('Uso: npm run process -- <nome-do-processo> [--headed] [args...]');
    return 1;
  }

  const entry = path.join(processesDir, name, 'index.ts');
  if (!existsSync(entry)) {
    console.error(`Processo "${name}" não encontrado em ${path.relative(process.cwd(), entry)}`);
    return 1;
  }

  const config = loadConfig();
  if (rest.includes('--headed')) config.headless = false;
  const args = rest.filter((arg) => arg !== '--headed');

  const logger = createLogger(name, config.logLevel, config.logsDir);
  const { default: rpa } = (await import(pathToFileURL(entry).href)) as { default: RpaProcess };

  const startedAt = Date.now();
  logger.info({ args }, `Iniciando processo ${rpa.name}`);
  try {
    await rpa.run({ config, logger, args });
    logger.info({ durationMs: Date.now() - startedAt }, 'Processo concluído');
    return 0;
  } catch (error) {
    logger.error({ err: error, durationMs: Date.now() - startedAt }, 'Processo falhou');
    return 1;
  }
}

process.exitCode = await main();
