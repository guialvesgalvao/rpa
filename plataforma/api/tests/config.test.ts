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

describe('lerConfig: Bling', () => {
  // Valores fictícios; a chave é 32 bytes de zeros em base64.
  const BLING = {
    BLING_CLIENT_ID: 'client-id-ficticio',
    BLING_CLIENT_SECRET: 'client-secret-ficticio',
    BLING_REDIRECT_URI: 'http://localhost:3001/v1/bling/oauth/retorno',
    BLING_CHAVE_TOKENS: Buffer.alloc(32).toString('base64'),
  };

  it('sem nenhuma variável do Bling, a sincronização fica desligada', () => {
    expect(lerConfig(OBRIGATORIAS).bling).toBeUndefined();
  });

  it('variáveis vazias (como no .env.example) contam como ausentes', () => {
    const vazias = {
      BLING_CLIENT_ID: '',
      BLING_CLIENT_SECRET: ' ',
      BLING_REDIRECT_URI: '',
      BLING_CHAVE_TOKENS: '',
    };
    expect(lerConfig({ ...OBRIGATORIAS, ...vazias }).bling).toBeUndefined();
  });

  it('com as quatro variáveis, lê o Bling com a pasta de dados padrão', () => {
    expect(lerConfig({ ...OBRIGATORIAS, ...BLING }).bling).toEqual({
      clientId: BLING.BLING_CLIENT_ID,
      clientSecret: BLING.BLING_CLIENT_SECRET,
      redirectUri: BLING.BLING_REDIRECT_URI,
      chaveTokens: BLING.BLING_CHAVE_TOKENS,
      dirDados: 'data/bling',
    });
  });

  it('lê BLING_DIR_DADOS', () => {
    expect(
      lerConfig({ ...OBRIGATORIAS, ...BLING, BLING_DIR_DADOS: '/tmp/bling' }).bling?.dirDados,
    ).toBe('/tmp/bling');
  });

  it('recusa configuração parcial, dizendo o que falta sem mostrar valores', () => {
    const semSegredo = { ...BLING, BLING_CLIENT_SECRET: undefined };
    const ler = () => lerConfig({ ...OBRIGATORIAS, ...semSegredo });
    expect(ler).toThrow(/incompleta.*BLING_CLIENT_SECRET/);
    expect(ler).not.toThrow(BLING.BLING_CLIENT_ID);
    expect(() => lerConfig({ ...OBRIGATORIAS, BLING_CLIENT_ID: 'x' })).toThrow(/incompleta/);
  });

  it('recusa redirect que não é URL e chave que não tem 32 bytes', () => {
    expect(() => lerConfig({ ...OBRIGATORIAS, ...BLING, BLING_REDIRECT_URI: 'localhost' })).toThrow(
      /BLING_REDIRECT_URI/,
    );
    const curta = Buffer.alloc(16).toString('base64');
    const ler = () => lerConfig({ ...OBRIGATORIAS, ...BLING, BLING_CHAVE_TOKENS: curta });
    expect(ler).toThrow(/BLING_CHAVE_TOKENS precisa ter 32 bytes/);
    expect(ler).not.toThrow(curta);
  });
});
