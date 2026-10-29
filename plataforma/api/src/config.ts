import { z } from 'zod';

const schema = z.object({
  PORT: z.coerce.number().int().min(1).max(65_535).default(3001),
  HOST: z.string().trim().min(1).default('::'),
  DATABASE_URL: z.string().trim().min(1, 'DATABASE_URL ausente'),
  // Chave do HS256: ao menos 32 bytes. Os testes não passam por aqui; injetam a chave em `criarApp`.
  JWT_SEGREDO: z
    .string()
    .refine((valor) => Buffer.byteLength(valor) >= 32, 'JWT_SEGREDO precisa de ao menos 32 bytes'),
});

export type Config = {
  porta: number;
  host: string;
  bancoUrl: string;
  jwtSegredo: string;
};

export function lerConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.parse(env);
  return {
    porta: parsed.PORT,
    host: parsed.HOST,
    bancoUrl: parsed.DATABASE_URL,
    jwtSegredo: parsed.JWT_SEGREDO,
  };
}
