import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { escolherPastaDeDados, escolherUrlDaApi } from '../../src/app/ambiente-dev.js';

describe('escolherUrlDaApi', () => {
  it('em dev, usa RPA_API_URL do ambiente', () => {
    expect(escolherUrlDaApi('http://build', { RPA_API_URL: 'http://localhost:3101' }, false)).toBe(
      'http://localhost:3101',
    );
  });

  it('sem a variável, ou com ela vazia, usa a do build', () => {
    expect(escolherUrlDaApi('http://build', {}, false)).toBe('http://build');
    expect(escolherUrlDaApi('http://build', { RPA_API_URL: '  ' }, false)).toBe('http://build');
  });

  it('no app instalado, ignora o ambiente', () => {
    expect(escolherUrlDaApi('http://build', { RPA_API_URL: 'http://outra' }, true)).toBe(
      'http://build',
    );
  });
});

describe('escolherPastaDeDados', () => {
  it('em dev, troca a pasta por RPA_DATA_DIR', () => {
    const pasta = path.resolve('tmp-e2e');
    expect(escolherPastaDeDados('/raiz', { RPA_DATA_DIR: pasta }, false)).toEqual({
      baseDir: pasta,
      isolada: true,
    });
  });

  it('sem a variável, ou no app instalado, mantém o padrão', () => {
    expect(escolherPastaDeDados('/raiz', {}, false)).toEqual({ baseDir: '/raiz', isolada: false });
    expect(escolherPastaDeDados('/raiz', { RPA_DATA_DIR: '/x' }, true)).toEqual({
      baseDir: '/raiz',
      isolada: false,
    });
  });
});
