import { expect, test } from '@playwright/test';

import { desativarUsuario, URL_API_MORTA, USUARIOS } from '../apoio/ambiente.js';
import { abrirApp, abrirAppLogado } from '../apoio/app.js';
import { raizArtes } from '../apoio/app-artes.js';

// 3.5 e 2.12 de testes-manuais-pendentes: a sessão salva sobrevive sem o servidor; usuário desativado sai
// quando o servidor volta. Usa um usuário só desta suíte (desativavel.e2e).

test('3.5 + 2.12 sem servidor segue com o perfil salvo; desativado, sai quando ele volta', async () => {
  test.setTimeout(120_000);
  const primeira = await abrirAppLogado(USUARIOS.desativavel);
  const { pastaDados } = primeira;
  await expect(primeira.janela.locator('#menu #usuario-nome')).toHaveText('Usuária Desativável');
  await primeira.app.close();

  // Servidor inacessível: o app abre logado, com a faixa offline e Artes indisponível.
  const offline = await abrirApp({ pastaDados, apiUrl: URL_API_MORTA });
  try {
    await expect(offline.janela.locator('#app')).toBeVisible();
    await expect(offline.janela.locator('#offline')).toBeVisible();
    await expect(offline.janela.locator('#artes-offline')).toHaveText(
      'Sem conexão com o servidor.',
    );
    const raiz = raizArtes(offline.janela);
    await expect(raiz.getByText(/Sem conexão com o servidor/)).toBeVisible();
    await expect(raiz.getByRole('button', { name: 'Tentar de novo' })).toBeVisible();
  } finally {
    await offline.app.close();
  }

  // Desativado no banco: com o servidor de volta, a renovação é recusada e o app desloga.
  desativarUsuario(USUARIOS.desativavel);
  const deVolta = await abrirApp({ pastaDados });
  try {
    await expect(deVolta.janela.locator('#login')).toBeVisible();
    await expect(deVolta.janela.locator('#app')).toBeHidden();
  } finally {
    await deVolta.app.close();
  }
});
