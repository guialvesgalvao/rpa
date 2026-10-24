import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { loadConfig } from '../../src/config/env.js';

describe('loadConfig', () => {
  const base = path.resolve('base-de-teste');

  it('resolve os caminhos padrão contra o baseDir', () => {
    const config = loadConfig({}, base);
    expect(config.logsDir).toBe(path.join(base, 'logs'));
    expect(config.artifactsDir).toBe(path.join(base, 'artifacts'));
    expect(config.profileDir).toBe(path.join(base, 'data', 'chrome-profile'));
    expect(config.downloadDir).toBe(path.join(base, 'data', 'downloads'));
    expect(config.bling.boletosDir).toBe(path.join(base, 'data', 'boletos'));
  });

  it('resolve caminhos relativos do .env contra o baseDir e mantém os absolutos', () => {
    const absoluto = path.resolve('outra', 'saida');
    const config = loadConfig({ RPA_INPUT_DIR: 'entrada', RPA_OUTPUT_DIR: absoluto }, base);
    expect(config.inputDir).toBe(path.join(base, 'entrada'));
    expect(config.outputDir).toBe(absoluto);
  });

  it('usa o diretório de trabalho quando não recebe baseDir', () => {
    expect(loadConfig({}).logsDir).toBe(path.resolve('logs'));
  });
});
