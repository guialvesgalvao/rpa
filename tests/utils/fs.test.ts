import { describe, expect, it } from 'vitest';

import { safeFileName, timestampedName, toWslPath } from '../../src/utils/fs.js';

describe('toWslPath', () => {
  it('converte caminho do Windows no WSL', () => {
    expect(toWslPath('C:\\Users\\fulano\\RPA\\output', 'linux')).toBe(
      '/mnt/c/Users/fulano/RPA/output',
    );
    expect(toWslPath('D:/dados', 'linux')).toBe('/mnt/d/dados');
  });

  it('mantém o caminho quando roda nativo no Windows', () => {
    expect(toWslPath('C:\\Users\\fulano\\RPA', 'win32')).toBe('C:\\Users\\fulano\\RPA');
  });

  it('mantém caminhos POSIX', () => {
    expect(toWslPath('/mnt/c/x', 'linux')).toBe('/mnt/c/x');
    expect(toWslPath('data/output', 'linux')).toBe('data/output');
  });
});

describe('safeFileName', () => {
  it('remove caracteres inválidos no Windows', () => {
    expect(safeFileName('nota: 1/2 <final>?.pdf')).toBe('nota_ 1_2 _final__.pdf');
    expect(safeFileName('arquivo. ')).toBe('arquivo');
    expect(safeFileName('???')).toBe('___');
    expect(safeFileName('  ')).toBe('arquivo');
  });
});

describe('timestampedName', () => {
  it('gera nome com data sem ":"', () => {
    const date = new Date('2026-01-02T03:04:05Z');
    expect(timestampedName('rel', '.pdf', date)).toBe('rel_2026-01-02T03-04-05.pdf');
  });
});
