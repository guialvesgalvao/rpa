import { z } from 'zod';

import { chaveValida } from './bling/cifra.js';

// Variável vazia (`BLING_CLIENT_ID=` no `.env`) conta como ausente.
const opcional = <T extends z.ZodType>(esquema: T) =>
  z.preprocess(
    (valor) => (typeof valor === 'string' && valor.trim() === '' ? undefined : valor),
    esquema.optional(),
  );

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
    BLING_DIR_DADOS: opcional(z.string().trim()),
  })
  .superRefine((env, ctx) => {
    const ausentes = VARIAVEIS_BLING.filter((nome) => env[nome] === undefined);
    if (ausentes.length > 0 && ausentes.length < VARIAVEIS_BLING.length)
      ctx.addIssue({
        code: 'custom',
        message: `Configuração do Bling incompleta; faltam: ${ausentes.join(', ')}`,
      });
  });

export type ConfigBling = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  // Base64 de 32 bytes (AES-256-GCM dos tokens no banco).
  chaveTokens: string;
  // Pasta do JSON da sincronização, relativa ao diretório de trabalho da API.
  dirDados: string;
};

export type Config = {
  porta: number;
  host: string;
  bancoUrl: string;
  jwtSegredo: string;
  // Ausente quando as variáveis do Bling não estão definidas: as rotas do Bling respondem 503.
  bling?: ConfigBling;
};

export function lerConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.parse(env);
  const config: Config = {
    porta: parsed.PORT,
    host: parsed.HOST,
    bancoUrl: parsed.DATABASE_URL,
    jwtSegredo: parsed.JWT_SEGREDO,
  };
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
      dirDados: parsed.BLING_DIR_DADOS ?? 'data/bling',
    };
  return config;
}
