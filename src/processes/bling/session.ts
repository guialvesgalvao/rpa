import type { Page } from 'playwright';

import type { Config } from '../../config/env.js';
import type { Logger } from '../../core/logger.js';

export const VENDAS_URL = 'https://www.bling.com.br/vendas.php#list';
const LOGIN_TIMEOUT_MS = 60_000;
/** Endpoint de onde a tela de login tira o token CSRF que vai junto no envio. */
const CSRF_API = '/Api/v3/auth/csrf-token';

const isBlingLogin = (url: URL) => url.hostname === 'www.bling.com.br' && url.pathname === '/login';

async function waitLeaveLogin(page: Page): Promise<void> {
  await page.waitForURL((url) => url.hostname === 'www.bling.com.br' && !isBlingLogin(url), {
    timeout: LOGIN_TIMEOUT_MS,
  });
}

/** Mensagem de erro exibida no formulário de login (ex.: "Não permitido."), se houver. */
async function loginErrorMessage(page: Page): Promise<string | undefined> {
  const alert = page
    .locator('[role="alert"], [class*="alert" i], [class*="error" i], [class*="erro" i]')
    .filter({ visible: true })
    .first();
  const text = await alert.textContent({ timeout: 2_000 }).catch(() => null);
  return text?.trim() || undefined;
}

/**
 * Login do usuário-robô por e-mail/senha (credenciais vêm do .env, nunca são logadas).
 * Só envia depois que a tela carregou o token CSRF: enviado sem ele, o Bling responde 403
 * "Não permitido." (acontecia porque o robô clicava em "Entrar" antes do token chegar).
 */
async function loginWithPassword(
  page: Page,
  csrf: Promise<unknown>,
  user: string,
  password: string,
): Promise<void> {
  if (!(await csrf)) {
    throw new Error('A tela de login do Bling não carregou o token de segurança (CSRF).');
  }
  await page.getByPlaceholder('Insira o nome do seu usuário ou e-mail').fill(user);
  await page.getByPlaceholder('Insira sua senha').fill(password);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  try {
    await waitLeaveLogin(page);
  } catch (error) {
    const message = await loginErrorMessage(page);
    if (!message) throw error;
    // Ex.: "Não permitido." após logins repetidos em pouco tempo; não insistir para não bloquear a conta.
    throw new Error(`O Bling recusou o login do usuário-robô: ${message}`, { cause: error });
  }
}

/**
 * Abre a listagem de vendas, fazendo login com o usuário-robô (BLING_USER/BLING_PASSWORD)
 * se o Bling pedir (a sessão não persiste entre execuções).
 */
export async function openVendas(page: Page, config: Config, logger: Logger): Promise<void> {
  // A tela de login busca o token assim que carrega; a espera começa antes da navegação para
  // não perder a resposta. Com sessão ativa ela nunca chega, e o timeout vira `null`.
  const csrf = page
    .waitForResponse((r) => r.url().includes(CSRF_API) && r.ok(), { timeout: LOGIN_TIMEOUT_MS })
    .catch(() => null);
  await page.goto(VENDAS_URL, { waitUntil: 'domcontentloaded' });
  if (isBlingLogin(new URL(page.url()))) {
    const { user, password } = config.bling;
    if (!user || !password) throw new Error('Defina BLING_USER e BLING_PASSWORD no .env.');
    logger.info('Sessão do Bling ausente, entrando com o usuário-robô');
    await loginWithPassword(page, csrf, user, password);
    logger.info('Login no Bling concluído');
    await page.goto(VENDAS_URL, { waitUntil: 'domcontentloaded' });
  }
  await page.waitForLoadState('load');

  const url = page.url();
  if (new URL(url).pathname !== '/vendas.php') {
    throw new Error(`Não chegou na página de vendas (está em ${url}).`);
  }
}
