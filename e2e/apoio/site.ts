import { expect, type Page } from '@playwright/test';

import { SENHA } from './ambiente.js';

/** Login pelo formulário do site; termina na página de Artes da empresa. */
export async function entrarNoSite(page: Page, email: string, senha = SENHA): Promise<void> {
  await page.goto('/entrar');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha').fill(senha);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page).toHaveURL(/\/(aba|roma)\/artes/);
}
