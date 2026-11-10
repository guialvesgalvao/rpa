import { expect, test } from '@playwright/test';

import { USUARIOS } from '../apoio/ambiente.js';
import { abrirAppLogado } from '../apoio/app.js';

test('@fumaca app entra, mostra o usuário e sai', async () => {
  const { app, janela } = await abrirAppLogado(USUARIOS.admin);
  try {
    await expect(janela.locator('#menu #usuario-nome')).toHaveText('Admin Fictício');
    await janela.locator('#sair').click();
    await expect(janela.locator('#login')).toBeVisible();
  } finally {
    await app.close();
  }
});
