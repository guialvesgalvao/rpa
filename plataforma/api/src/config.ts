import { z } from 'zod';

const schema = z.object({
  PORT: z.coerce.number().int().min(1).max(65_535).default(3001),
  HOST: z.string().trim().min(1).default('::'),
});

export type Config = {
  porta: number;
  host: string;
};

export function lerConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.parse(env);
  return { porta: parsed.PORT, host: parsed.HOST };
}
