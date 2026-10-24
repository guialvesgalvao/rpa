import { existsSync } from 'node:fs';
import path from 'node:path';
import { chromium, type BrowserContext, type Page } from 'playwright';

import type { Config } from '../config/env.js';
import { ensureDir, timestampedName } from '../utils/fs.js';
import type { Logger } from './logger.js';

export type BrowserSession = { page: Page; context: BrowserContext };

const CLOSE_TIMEOUT_MS = 10_000;

const contextOptions = { acceptDownloads: true, locale: 'pt-BR' } as const;

/**
 * Caminho do Chrome a usar: o configurado ou, se ele não existir, a instalação por usuário
 * (`%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe`). Falha com mensagem amigável se
 * nenhum existir.
 */
export function localizarChrome(
  configurado: string,
  env: NodeJS.ProcessEnv = process.env,
  existe: (caminho: string) => boolean = existsSync,
): string {
  const candidatos = [configurado];
  if (env.LOCALAPPDATA) {
    candidatos.push(
      path.win32.join(env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    );
  }
  const encontrado = candidatos.find((caminho) => existe(caminho));
  if (!encontrado) {
    throw new Error(
      `Google Chrome não encontrado em "${configurado}". Instale o Chrome ou indique o caminho nas Configurações.`,
    );
  }
  return encontrado;
}

/**
 * Abre o contexto do navegador conforme `config.browserChannel`:
 * - `chrome`: Chrome instalado na máquina, com perfil persistente em `config.profileDir`
 *   (cookies/logins mantidos entre execuções). Fechar o contexto encerra o navegador.
 * - `chromium`: Chromium do Playwright com contexto descartável.
 */
async function openContext(
  config: Config,
): Promise<{ context: BrowserContext; close(): Promise<void> }> {
  const launchOptions = { headless: config.headless, slowMo: config.slowMo };
  if (config.browserChannel === 'chrome') {
    const profileDir = await ensureDir(config.profileDir);
    const context = await chromium.launchPersistentContext(profileDir, {
      ...launchOptions,
      ...contextOptions,
      executablePath: localizarChrome(config.chromePath),
    });
    return { context, close: () => context.close() };
  }
  const browser = await chromium.launch(launchOptions);
  const context = await browser.newContext(contextOptions);
  return { context, close: () => browser.close() };
}

/**
 * Abre o navegador, executa fn e fecha tudo, mesmo em caso de erro.
 * Em falha, salva screenshot e trace (abrir com `npx playwright show-trace <arquivo>`) em artifacts/.
 */
export async function withBrowser<T>(
  config: Config,
  logger: Logger,
  fn: (session: BrowserSession) => Promise<T>,
): Promise<T> {
  const { context, close } = await openContext(config);
  context.setDefaultTimeout(config.timeoutMs);
  await context.tracing.start({ screenshots: true, snapshots: true });
  const page = context.pages()[0] ?? (await context.newPage());

  try {
    const result = await fn({ page, context });
    await context.tracing.stop();
    return result;
  } catch (error) {
    const dir = await ensureDir(config.artifactsDir);
    const screenshot = path.join(dir, timestampedName('erro', '.png'));
    const trace = path.join(dir, timestampedName('trace', '.zip'));
    await page.screenshot({ path: screenshot, fullPage: true }).catch(() => undefined);
    await context.tracing.stop({ path: trace }).catch(() => undefined);
    logger.error({ screenshot, trace }, 'Falha durante automação no navegador');
    throw error;
  } finally {
    // O close() do Playwright pode travar se o Chrome já tiver saído; não deixa o processo pendurado.
    const timeout = new Promise<'timeout'>((resolve) =>
      setTimeout(() => resolve('timeout'), CLOSE_TIMEOUT_MS).unref(),
    );
    if ((await Promise.race([close(), timeout])) === 'timeout') {
      logger.warn({ timeoutMs: CLOSE_TIMEOUT_MS }, 'Navegador não fechou a tempo');
    }
  }
}
