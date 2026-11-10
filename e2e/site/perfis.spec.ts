import { expect, test } from '@playwright/test';

import { ESTADO_SITE, USUARIOS } from '../apoio/ambiente.js';
import { apiComo, artesDoProduto, produtosDoCliente } from '../apoio/api.js';
import { clienteDoSeed } from '../apoio/site-artes.js';
import { entrarNoSite } from '../apoio/site.js';

// Perfis e empresas: 2.13 de testes-manuais-pendentes, Usuários e troca de empresa.

test('2.13 arte-finalista não edita nem remove arte pela API; admin remove', async () => {
  // O 4º cliente do seed tem artes.
  const cliente = await clienteDoSeed('aba', 3);
  const admin = await apiComo(USUARIOS.admin);
  const finalista = await apiComo(USUARIOS.finalista);
  try {
    const [produto] = await produtosDoCliente(admin, 'aba', cliente.id);
    const [arte] = await artesDoProduto(admin, 'aba', cliente.id, produto!.id);
    const caminho = `/v1/empresas/aba/artes/${arte!.id}`;

    expect((await finalista.ctx.patch(caminho, { multipart: { nome: 'Outro' } })).status()).toBe(
      403,
    );
    expect((await finalista.ctx.delete(caminho)).status()).toBe(403);
    expect((await admin.ctx.delete(caminho)).status()).toBe(204);
  } finally {
    await admin.fechar();
    await finalista.fechar();
  }
});

test.describe('Usuários (admin)', () => {
  test.use({ storageState: ESTADO_SITE.admin });

  test('admin cria um usuário pela tela', async ({ page }) => {
    await page.goto('/aba/usuarios');
    await page.getByLabel('Nome', { exact: true }).fill('Pessoa Fictícia E2E');
    await page.getByLabel('E-mail').fill('nova.e2e@exemplo.com');
    await page.getByLabel('Perfil').selectOption('arte_finalista');
    await page.getByRole('group', { name: 'Empresas' }).getByLabel('ABA Embalagens').check();
    await page.getByLabel('Senha inicial').fill('senha-inicial-e2e-123');
    await page.getByRole('button', { name: 'Criar usuário' }).click();
    await expect(page.getByRole('status')).toContainText('Usuário nova.e2e@exemplo.com criado');
    await expect(page.getByRole('cell', { name: 'nova.e2e@exemplo.com' })).toBeVisible();
  });

  test('troca de empresa ABA → Roma pelo seletor', async ({ page }) => {
    await page.goto('/aba/artes');
    await page.getByLabel(/^Empresa: .*Trocar de empresa$/).click();
    await page.getByRole('button', { name: /roma/i }).click();
    await expect(page).toHaveURL(/\/roma\/artes/);
    await expect(page.getByLabel(/^Empresa: .*Trocar de empresa$/)).toHaveAccessibleName(/roma/i);
  });
});

test.describe('Usuários (arte-finalista)', () => {
  test.use({ storageState: ESTADO_SITE.finalista });

  test('arte-finalista não vê Usuários e a página dá "não encontrada"', async ({ page }) => {
    await page.goto('/aba/artes');
    const abas = page.getByRole('navigation', { name: 'Abas' });
    await expect(abas.getByRole('link', { name: 'Artes' })).toBeVisible();
    await expect(abas.getByRole('link', { name: 'Usuários' })).toHaveCount(0);
    await page.goto('/aba/usuarios');
    await expect(
      page.getByRole('heading', { name: 'Página não encontrada' }).first(),
    ).toBeVisible();
  });
});

test('usuário com senha inicial troca a senha no primeiro login', async ({ page }) => {
  await page.goto('/entrar');
  await page.getByLabel('E-mail').fill(USUARIOS.trocaSenha);
  await page.getByLabel('Senha').fill('senha-errada');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.locator('main').getByRole('alert')).toHaveText('E-mail ou senha inválidos.');

  await page.getByLabel('E-mail').fill(USUARIOS.trocaSenha);
  await page.getByLabel('Senha').fill('senha-dev-1234');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page).toHaveURL(/\/trocar-senha/);
  await page.locator('#senhaAtual').fill('senha-dev-1234');
  await page.locator('#novaSenha').fill('senha-nova-e2e-456');
  await page.locator('#confirmacao').fill('senha-nova-e2e-456');
  await page.getByRole('button', { name: /trocar/i }).click();
  await expect(page).toHaveURL(/\/aba\/artes/);

  // A senha nova vale no próximo login.
  await page.context().clearCookies();
  await entrarNoSite(page, USUARIOS.trocaSenha, 'senha-nova-e2e-456');
});
