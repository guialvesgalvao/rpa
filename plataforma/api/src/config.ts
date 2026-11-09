import type { EmpresaSincronizacaoBling } from '@plataforma/contratos';
import { z } from 'zod';

import type { ConfigS3 } from './arquivos/s3.js';
import { chaveValida } from './bling/cifra.js';

// Variável vazia (`BLING_CLIENT_ID=` no `.env`) conta como ausente.
const opcional = <T extends z.ZodType>(esquema: T) =>
  z.preprocess(
    (valor) => (typeof valor === 'string' && valor.trim() === '' ? undefined : valor),
    esquema.optional(),
  );

// Bucket S3 dos arquivos (Railway Storage Bucket): todas ou nenhuma. Sem elas, o conteúdo fica no Postgres.
const VARIAVEIS_S3 = [
  'ARQUIVOS_S3_ENDPOINT',
  'ARQUIVOS_S3_REGIAO',
  'ARQUIVOS_S3_BUCKET',
  'ARQUIVOS_S3_CHAVE',
  'ARQUIVOS_S3_SEGREDO',
] as const;

const camposS3 = {
  ARQUIVOS_S3_ENDPOINT: opcional(z.url({ error: 'ARQUIVOS_S3_ENDPOINT precisa ser uma URL' })),
  ARQUIVOS_S3_REGIAO: opcional(z.string().trim()),
  ARQUIVOS_S3_BUCKET: opcional(z.string().trim()),
  ARQUIVOS_S3_CHAVE: opcional(z.string().trim()),
  ARQUIVOS_S3_SEGREDO: opcional(z.string().trim()),
  // `true`: endereço no estilo endpoint/bucket/chave (conforme a aba Credentials do bucket).
  ARQUIVOS_S3_ESTILO_CAMINHO: opcional(
    z.enum(['true', 'false'], { error: 'ARQUIVOS_S3_ESTILO_CAMINHO precisa ser true ou false' }),
  ),
};
type EnvS3 = z.infer<z.ZodObject<typeof camposS3>>;

function conferirS3(env: EnvS3, ctx: z.RefinementCtx): void {
  const ausentes = VARIAVEIS_S3.filter((nome) => env[nome] === undefined);
  if (ausentes.length > 0 && ausentes.length < VARIAVEIS_S3.length)
    ctx.addIssue({
      code: 'custom',
      message: `Configuração do bucket incompleta; faltam: ${ausentes.join(', ')}`,
    });
}

function montarS3(env: EnvS3): ConfigS3 | undefined {
  if (
    env.ARQUIVOS_S3_ENDPOINT === undefined ||
    env.ARQUIVOS_S3_REGIAO === undefined ||
    env.ARQUIVOS_S3_BUCKET === undefined ||
    env.ARQUIVOS_S3_CHAVE === undefined ||
    env.ARQUIVOS_S3_SEGREDO === undefined
  )
    return undefined;
  return {
    endpoint: env.ARQUIVOS_S3_ENDPOINT,
    regiao: env.ARQUIVOS_S3_REGIAO,
    bucket: env.ARQUIVOS_S3_BUCKET,
    chave: env.ARQUIVOS_S3_CHAVE,
    segredo: env.ARQUIVOS_S3_SEGREDO,
    estiloCaminho: env.ARQUIVOS_S3_ESTILO_CAMINHO === 'true',
  };
}

// Só o bucket, para a CLI de migração dos arquivos (não exige as variáveis da API).
export function lerConfigS3(env: NodeJS.ProcessEnv = process.env): ConfigS3 | undefined {
  return montarS3(z.object(camposS3).superRefine(conferirS3).parse(env));
}

const VARIAVEIS_BLING = [
  'BLING_CLIENT_ID',
  'BLING_CLIENT_SECRET',
  'BLING_REDIRECT_URI',
  'BLING_CHAVE_TOKENS',
] as const;

const schema = z
  .object({
    PORT: z.coerce.number().int().min(1).max(65_535).default(3001),
    HOST: z.string().trim().min(1).default('::'),
    DATABASE_URL: z.string().trim().min(1, 'DATABASE_URL ausente'),
    // Chave do HS256: ao menos 32 bytes. Os testes não passam por aqui; injetam a chave em `criarApp`.
    JWT_SEGREDO: z
      .string()
      .refine(
        (valor) => Buffer.byteLength(valor) >= 32,
        'JWT_SEGREDO precisa de ao menos 32 bytes',
      ),
    // App do Bling (API v3): as quatro primeiras juntas, ou nenhuma (sincronização desligada).
    BLING_CLIENT_ID: opcional(z.string().trim()),
    BLING_CLIENT_SECRET: opcional(z.string().trim()),
    BLING_REDIRECT_URI: opcional(z.url({ error: 'BLING_REDIRECT_URI precisa ser uma URL' })),
    BLING_CHAVE_TOKENS: opcional(
      z.string().trim().refine(chaveValida, 'BLING_CHAVE_TOKENS precisa ter 32 bytes em base64'),
    ),
    // CNPJ da conta do Bling esperada para a empresa (com ou sem máscara). Fora do grupo das quatro: sem ele, a
    // conexão só confere se o CNPJ não está ligado a outra empresa.
    BLING_ROMA_CNPJ: opcional(
      z
        .string()
        .transform((valor) => valor.replace(/\D/g, ''))
        .refine((cnpj) => cnpj.length === 14, 'BLING_ROMA_CNPJ precisa ter 14 dígitos'),
    ),
    // Sincronização automática (agendador dentro da API): desligada por padrão.
    BLING_SINCRONIZACAO_AUTOMATICA: opcional(
      z.enum(['true', 'false'], {
        error: 'BLING_SINCRONIZACAO_AUTOMATICA precisa ser true ou false',
      }),
    ),
    BLING_INTERVALO_MINUTOS: opcional(
      z.coerce
        .number()
        .int()
        .min(5, 'BLING_INTERVALO_MINUTOS precisa ser de 5 a 1440')
        .max(1440, 'BLING_INTERVALO_MINUTOS precisa ser de 5 a 1440'),
    ),
    ...camposS3,
    BLING_COMPLETA_DIAS: opcional(
      z.coerce
        .number()
        .int()
        .min(1, 'BLING_COMPLETA_DIAS precisa ser de 1 a 30')
        .max(30, 'BLING_COMPLETA_DIAS precisa ser de 1 a 30'),
    ),
  })
  .superRefine((env, ctx) => {
    conferirS3(env, ctx);
    const ausentes = VARIAVEIS_BLING.filter((nome) => env[nome] === undefined);
    if (ausentes.length > 0 && ausentes.length < VARIAVEIS_BLING.length)
      ctx.addIssue({
        code: 'custom',
        message: `Configuração do Bling incompleta; faltam: ${ausentes.join(', ')}`,
      });
    else if (ausentes.length > 0 && env.BLING_SINCRONIZACAO_AUTOMATICA === 'true')
      ctx.addIssue({
        code: 'custom',
        message: `BLING_SINCRONIZACAO_AUTOMATICA=true exige ${VARIAVEIS_BLING.join(', ')}`,
      });
  });

export type ConfigSincronizacaoAutomatica = {
  ligada: boolean;
  intervaloMinutos: number;
  completaDias: number;
};

export type ConfigBling = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  // Base64 de 32 bytes (AES-256-GCM dos tokens no banco).
  chaveTokens: string;
  // CNPJ (só dígitos) da conta do Bling que cada empresa pode conectar; ausente, qualquer conta ainda não ligada
  // a outra empresa.
  cnpjsEsperados: Partial<Record<EmpresaSincronizacaoBling, string>>;
  automatica: ConfigSincronizacaoAutomatica;
};

export type Config = {
  porta: number;
  host: string;
  bancoUrl: string;
  jwtSegredo: string;
  // Ausente quando as variáveis do Bling não estão definidas: as rotas do Bling respondem 503.
  bling?: ConfigBling;
  // Ausente sem as variáveis ARQUIVOS_S3_*: os arquivos ficam no Postgres (bytea).
  arquivosS3?: ConfigS3;
};

export function lerConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.parse(env);
  const config: Config = {
    porta: parsed.PORT,
    host: parsed.HOST,
    bancoUrl: parsed.DATABASE_URL,
    jwtSegredo: parsed.JWT_SEGREDO,
  };
  const arquivosS3 = montarS3(parsed);
  if (arquivosS3) config.arquivosS3 = arquivosS3;
  if (
    parsed.BLING_CLIENT_ID !== undefined &&
    parsed.BLING_CLIENT_SECRET !== undefined &&
    parsed.BLING_REDIRECT_URI !== undefined &&
    parsed.BLING_CHAVE_TOKENS !== undefined
  )
    config.bling = {
      clientId: parsed.BLING_CLIENT_ID,
      clientSecret: parsed.BLING_CLIENT_SECRET,
      redirectUri: parsed.BLING_REDIRECT_URI,
      chaveTokens: parsed.BLING_CHAVE_TOKENS,
      cnpjsEsperados: parsed.BLING_ROMA_CNPJ === undefined ? {} : { roma: parsed.BLING_ROMA_CNPJ },
      automatica: {
        ligada: parsed.BLING_SINCRONIZACAO_AUTOMATICA === 'true',
        intervaloMinutos: parsed.BLING_INTERVALO_MINUTOS ?? 15,
        completaDias: parsed.BLING_COMPLETA_DIAS ?? 3,
      },
    };
  return config;
}
