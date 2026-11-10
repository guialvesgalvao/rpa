import { _electron, type ElectronApplication, expect, type Page } from '@playwright/test';

import { RAIZ, SENHA, URL_API, exigirLocal } from './ambiente.js';
import { pastaTemporaria } from './arquivos.js';

// O app roda isolado: pasta de dados temporária (RPA_DATA_DIR), API local da suíte (RPA_API_URL) e OP com a
// fixture sintética (RPA_OP_MOCK=1). O .env da raiz não é lido e nenhuma credencial do Bling é passada.

export type App = { app: ElectronApplication; janela: Page; pastaDados: string };

export type OpcoesApp = { apiUrl?: string; pastaDados?: string };

function ambienteDoApp(apiUrl: string, pastaDados: string): Record<string, string> {
  const herdado = Object.fromEntries(
    Object.entries(process.env).filter(
      (par): par is [string, string] => par[1] !== undefined && !/^(BLING_|RPA_)/.test(par[0]),
    ),
  );
  return {
    ...herdado,
    RPA_DATA_DIR: pastaDados,
    RPA_API_URL: apiUrl,
    RPA_OP_MOCK: '1',
    // Caminho que não existe: o dotenv do app não carrega o .env local.
    DOTENV_CONFIG_PATH: `${RAIZ}/e2e/.sem-env`,
    BROWSER_CHANNEL: 'chromium',
    HEADLESS: 'true',
    LOG_LEVEL: 'warn',
  };
}

export async function abrirApp({
  apiUrl = URL_API,
  pastaDados = pastaTemporaria('app'),
}: OpcoesApp = {}): Promise<App> {
  exigirLocal(apiUrl);
  const env = ambienteDoApp(apiUrl, pastaDados);
  if (env.RPA_OP_MOCK !== '1') throw new Error('A suíte E2E exige RPA_OP_MOCK=1.');
  const app = await _electron.launch({ args: ['.'], cwd: RAIZ, env });
  const janela = await app.firstWindow();
  await expect(janela.locator('#carregando')).toBeHidden({ timeout: 30_000 });
  return { app, janela, pastaDados };
}

/** Configurações abre sozinha para o admin sem Bling configurado; a suíte nunca a usa. */
export async function fecharConfiguracoesSeAbrir(janela: Page): Promise<void> {
  const config = janela.locator('dialog#config');
  try {
    await config.waitFor({ state: 'visible', timeout: 3_000 });
  } catch {
    return;
  }
  await janela.locator('#cfg-cancelar').click();
  await expect(config).toBeHidden();
}

export async function entrarNoApp(janela: Page, email: string, senha = SENHA): Promise<void> {
  await janela.locator('#login-email').fill(email);
  await janela.locator('#login-senha').fill(senha);
  await janela.locator('#login-entrar').click();
  await expect(janela.locator('#app')).toBeVisible({ timeout: 20_000 });
  await fecharConfiguracoesSeAbrir(janela);
}

/** Abre o app já logado com `email`. */
export async function abrirAppLogado(email: string, opcoes: OpcoesApp = {}): Promise<App> {
  const aberto = await abrirApp(opcoes);
  await entrarNoApp(aberto.janela, email);
  return aberto;
}

/** Troca o diálogo nativo de arquivo do processo principal por um que devolve `caminho`. */
export async function escolherArquivoNoDialogo(
  app: ElectronApplication,
  caminho: string,
): Promise<void> {
  await app.evaluate(({ dialog }, escolhido) => {
    dialog.showOpenDialog = (async () => ({
      canceled: false,
      filePaths: [escolhido],
    })) as unknown as typeof dialog.showOpenDialog;
  }, caminho);
}

export async function abrirAba(janela: Page, rotulo: string): Promise<void> {
  await janela.locator('#menu').getByRole('button', { name: rotulo, exact: true }).click();
}
