import { describe, expect, it } from 'vitest';

import { lerConfig } from '../src/config.js';

describe('lerConfig', () => {
  it('usa a porta 3001 e todas as interfaces por padrão', () => {
    expect(lerConfig({})).toEqual({ porta: 3001, host: '::' });
  });

  it('lê PORT e HOST do ambiente', () => {
    expect(lerConfig({ PORT: '8080', HOST: '127.0.0.1' })).toEqual({
      porta: 8080,
      host: '127.0.0.1',
    });
  });

  it('rejeita porta inválida', () => {
    expect(() => lerConfig({ PORT: 'abc' })).toThrow();
    expect(() => lerConfig({ PORT: '70000' })).toThrow();
  });
});
