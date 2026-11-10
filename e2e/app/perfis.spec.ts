import { expect, type Page, test } from '@playwright/test';

import { URL_API_MORTA, USUARIOS } from '../apoio/ambiente.js';
import { abrirApp, abrirAppLogado, fecharConfiguracoesSeAbrir } from '../apoio/app.js';

// Abas por perfil e por empresa, troca de empresa e login sem servidor.

const abasDoMenu = (janela: Page) =>
  janela
    .locator('#menu button[data-aba]')
    .evaluateAll((botoes) => botoes.map((b) => b.textContent?.trim() ?? ''));

test('arte-finalista vê só a aba Artes', async () => {
  const { app, janela } = await abrirAppLogado(USUARIOS.finalista);
  try {
    expect(await abasDoMenu(janela)).toEqual(['Artes']);
  } finally {
    await app.close();
  }
});

test('admin: OP só aparece na Roma; troca de empresa pelo seletor', async () => {
  const { app, janela } = await abrirAppLogado(USUARIOS.admin);
  try {
    await expect(janela.locator('#empresa-nome')).toHaveText(/ABA/);
    expect(await abasDoMenu(janela)).toEqual(['Artes', 'Fatura', 'Usuários']);

    await janela.locator('#empresa').click();
    await janela.locator('dialog#empresas').getByRole('button', { name: /Roma/ }).click();
    await fecharConfiguracoesSeAbrir(janela);
    await expect(janela.locator('#empresa-nome')).toHaveText(/Roma/);
    expect(await abasDoMenu(janela)).toEqual(['Artes', 'Fatura', 'OP', 'Usuários']);
  } finally {
    await app.close();
  }
});

test('login sem o servidor mostra "Sem conexão com o servidor"', async () => {
  const { app, janela } = await abrirApp({ apiUrl: URL_API_MORTA });
  try {
    await janela.locator('#login-email').fill(USUARIOS.admin);
    await janela.locator('#login-senha').fill('senha-dev-1234');
    await janela.locator('#login-entrar').click();
    await expect(janela.locator('#login-erro')).toContainText('Sem conexão com o servidor');
    await expect(janela.locator('#app')).toBeHidden();
  } finally {
    await app.close();
  }
});
