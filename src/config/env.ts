import path from 'node:path';
import 'dotenv/config';
import { z } from 'zod';

import { toWslPath } from '../utils/fs.js';

const dir = (fallback: string) =>
  z
    .string()
    .trim()
    .optional()
    .transform((value) => path.resolve(value ? toWslPath(value) : fallback));

const bool = z
  .enum(['true', 'false', '1', '0'])
  .optional()
  .transform((value) => value === undefined || value === 'true' || value === '1');

const optionalText = z
  .string()
  .trim()
  .optional()
  .transform((value) => value || undefined);

const schema = z.object({
  RPA_INPUT_DIR: dir('data/input'),
  RPA_OUTPUT_DIR: dir('data/output'),
  RPA_DOWNLOAD_DIR: dir('data/downloads'),
  BROWSER_CHANNEL: z.enum(['chrome', 'chromium']).default('chrome'),
  CHROME_PROFILE_DIR: dir('data/chrome-profile'),
  CHROME_PATH: z
    .string()
    .trim()
    .default(String.raw`C:\Program Files\Google\Chrome\Application\chrome.exe`),
  HEADLESS: bool,
  SLOW_MO: z.coerce.number().int().min(0).default(0),
  TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error']).default('info'),
  BLING_USER: optionalText,
  BLING_PASSWORD: optionalText,
  BLING_BOLETOS_DIR: dir('data/boletos'),
});

export type Config = {
  inputDir: string;
  outputDir: string;
  downloadDir: string;
  artifactsDir: string;
  logsDir: string;
  /** `chrome` = Chrome instalado na máquina (perfil persistente); `chromium` = Chromium do Playwright. */
  browserChannel: z.infer<typeof schema>['BROWSER_CHANNEL'];
  profileDir: string;
  chromePath: string;
  headless: boolean;
  slowMo: number;
  timeoutMs: number;
  logLevel: z.infer<typeof schema>['LOG_LEVEL'];
  bling: {
    /** Usuário-robô do Bling (obrigatório para os processos do Bling). */
    user?: string;
    password?: string;
    boletosDir: string;
  };
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    throw new Error(`Configuração inválida no .env:\n${z.prettifyError(parsed.error)}`);
  }
  const e = parsed.data;
  return {
    inputDir: e.RPA_INPUT_DIR,
    outputDir: e.RPA_OUTPUT_DIR,
    downloadDir: e.RPA_DOWNLOAD_DIR,
    artifactsDir: path.resolve('artifacts'),
    logsDir: path.resolve('logs'),
    browserChannel: e.BROWSER_CHANNEL,
    profileDir: e.CHROME_PROFILE_DIR,
    chromePath: e.CHROME_PATH,
    headless: e.HEADLESS,
    slowMo: e.SLOW_MO,
    timeoutMs: e.TIMEOUT_MS,
    logLevel: e.LOG_LEVEL,
    bling: { user: e.BLING_USER, password: e.BLING_PASSWORD, boletosDir: e.BLING_BOLETOS_DIR },
  };
}
