import { describe, expect, it } from 'vitest';

import { lerConfig } from '../src/config.js';

// Valores fictícios.
const OBRIGATORIAS = {
  DATABASE_URL: 'postgres://usuario:senha@localhost:5433/rpa',
  JWT_SEGREDO: 'x'.repeat(32),
};

describe('lerConfig', () => {
  it('usa a porta 3001 e todas as interfaces por padrão', () => {
    expect(lerConfig(OBRIGATORIAS)).toEqual({
      porta: 3001,
      host: '::',
      bancoUrl: OBRIGATORIAS.DATABASE_URL,
      jwtSegredo: OBRIGATORIAS.JWT_SEGREDO,
    });
  });

  it('lê PORT e HOST do ambiente', () => {
    expect(lerConfig({ ...OBRIGATORIAS, PORT: '8080', HOST: '127.0.0.1' })).toMatchObject({
      porta: 8080,
      host: '127.0.0.1',
    });
  });

  it('rejeita porta inválida', () => {
    expect(() => lerConfig({ ...OBRIGATORIAS, PORT: 'abc' })).toThrow();
    expect(() => lerConfig({ ...OBRIGATORIAS, PORT: '70000' })).toThrow();
  });

  it('exige DATABASE_URL', () => {
    expect(() => lerConfig({ JWT_SEGREDO: OBRIGATORIAS.JWT_SEGREDO })).toThrow(/DATABASE_URL/);
  });

  it('exige JWT_SEGREDO com ao menos 32 bytes, sem mostrar o valor no erro', () => {
    expect(() => lerConfig({ DATABASE_URL: OBRIGATORIAS.DATABASE_URL })).toThrow(/JWT_SEGREDO/);
    const curto = 'segredo-curto-31-bytes-xxxxxxxx';
    expect(curto).toHaveLength(31);
    expect(() => lerConfig({ ...OBRIGATORIAS, JWT_SEGREDO: curto })).toThrow(
      /JWT_SEGREDO precisa de ao menos 32 bytes/,
    );
    expect(() => lerConfig({ ...OBRIGATORIAS, JWT_SEGREDO: curto })).not.toThrow(curto);
  });

  it('conta bytes, não caracteres', () => {
    expect(() => lerConfig({ ...OBRIGATORIAS, JWT_SEGREDO: 'ç'.repeat(16) })).not.toThrow();
  });
});
