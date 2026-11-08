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

  it('com as quatro variáveis, lê o Bling', () => {
    expect(lerConfig({ ...OBRIGATORIAS, ...BLING }).bling).toEqual({
      clientId: BLING.BLING_CLIENT_ID,
      clientSecret: BLING.BLING_CLIENT_SECRET,
      redirectUri: BLING.BLING_REDIRECT_URI,
      chaveTokens: BLING.BLING_CHAVE_TOKENS,
      automatica: { ligada: false, intervaloMinutos: 15, completaDias: 3 },
    });
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

describe('lerConfig: sincronização automática do Bling', () => {
  const BLING = {
    BLING_CLIENT_ID: 'client-id-ficticio',
    BLING_CLIENT_SECRET: 'client-secret-ficticio',
    BLING_REDIRECT_URI: 'http://localhost:3001/v1/bling/oauth/retorno',
    BLING_CHAVE_TOKENS: Buffer.alloc(32).toString('base64'),
  };
  const automatica = (env: Record<string, string>) =>
    lerConfig({ ...OBRIGATORIAS, ...BLING, ...env }).bling?.automatica;

  it('fica desligada por padrão, inclusive com a variável vazia', () => {
    expect(automatica({})).toEqual({ ligada: false, intervaloMinutos: 15, completaDias: 3 });
    expect(automatica({ BLING_SINCRONIZACAO_AUTOMATICA: '' })?.ligada).toBe(false);
    expect(automatica({ BLING_SINCRONIZACAO_AUTOMATICA: 'false' })?.ligada).toBe(false);
  });

  it('lê a variável ligada, o intervalo e a completa', () => {
    expect(
      automatica({
        BLING_SINCRONIZACAO_AUTOMATICA: 'true',
        BLING_INTERVALO_MINUTOS: '5',
        BLING_COMPLETA_DIAS: '30',
      }),
    ).toEqual({ ligada: true, intervaloMinutos: 5, completaDias: 30 });
    expect(automatica({ BLING_INTERVALO_MINUTOS: '1440', BLING_COMPLETA_DIAS: '1' })).toMatchObject(
      { intervaloMinutos: 1440, completaDias: 1 },
    );
  });

  it('recusa valores fora dos limites ou que não são true/false', () => {
    for (const [nome, valor, mensagem] of [
      ['BLING_INTERVALO_MINUTOS', '4', /BLING_INTERVALO_MINUTOS precisa ser de 5 a 1440/],
      ['BLING_INTERVALO_MINUTOS', '1441', /BLING_INTERVALO_MINUTOS/],
      ['BLING_INTERVALO_MINUTOS', '7.5', /BLING_INTERVALO_MINUTOS/],
      ['BLING_COMPLETA_DIAS', '0', /BLING_COMPLETA_DIAS precisa ser de 1 a 30/],
      ['BLING_COMPLETA_DIAS', '31', /BLING_COMPLETA_DIAS/],
      ['BLING_SINCRONIZACAO_AUTOMATICA', 'sim', /true ou false/],
    ] as const)
      expect(() => automatica({ [nome]: valor })).toThrow(mensagem);
  });

  it('ligada sem as quatro BLING_* é erro de configuração', () => {
    expect(() => lerConfig({ ...OBRIGATORIAS, BLING_SINCRONIZACAO_AUTOMATICA: 'true' })).toThrow(
      /BLING_SINCRONIZACAO_AUTOMATICA=true exige BLING_CLIENT_ID/,
    );
    expect(lerConfig({ ...OBRIGATORIAS, BLING_SINCRONIZACAO_AUTOMATICA: 'false' }).bling).toBe(
      undefined,
    );
  });
});

describe('bucket S3 dos arquivos', () => {
  const S3 = {
    ARQUIVOS_S3_ENDPOINT: 'http://localhost:9090',
    ARQUIVOS_S3_REGIAO: 'us-east-1',
    ARQUIVOS_S3_BUCKET: 'rpa-arquivos',
    ARQUIVOS_S3_CHAVE: 'chave-ficticia',
    ARQUIVOS_S3_SEGREDO: 'segredo-ficticio',
  };

  it('sem as variáveis (ou vazias), os arquivos ficam no Postgres', () => {
    expect(lerConfig(OBRIGATORIAS).arquivosS3).toBeUndefined();
    const vazias = Object.fromEntries(Object.keys(S3).map((nome) => [nome, '']));
    expect(lerConfig({ ...OBRIGATORIAS, ...vazias }).arquivosS3).toBeUndefined();
  });

  it('com as cinco, lê o bucket; estilo de caminho só com true', () => {
    expect(lerConfig({ ...OBRIGATORIAS, ...S3 }).arquivosS3).toEqual({
      endpoint: S3.ARQUIVOS_S3_ENDPOINT,
      regiao: S3.ARQUIVOS_S3_REGIAO,
      bucket: S3.ARQUIVOS_S3_BUCKET,
      chave: S3.ARQUIVOS_S3_CHAVE,
      segredo: S3.ARQUIVOS_S3_SEGREDO,
      estiloCaminho: false,
    });
    expect(
      lerConfig({ ...OBRIGATORIAS, ...S3, ARQUIVOS_S3_ESTILO_CAMINHO: 'true' }).arquivosS3
        ?.estiloCaminho,
    ).toBe(true);
  });

  it('recusa configuração parcial, dizendo o que falta sem mostrar valores', () => {
    const parcial = { ...S3, ARQUIVOS_S3_SEGREDO: '' };
    expect(() => lerConfig({ ...OBRIGATORIAS, ...parcial })).toThrow(/ARQUIVOS_S3_SEGREDO/);
    try {
      lerConfig({ ...OBRIGATORIAS, ...parcial });
    } catch (erro) {
      expect(String(erro)).not.toContain('chave-ficticia');
    }
  });
});
