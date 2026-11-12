import { expect, test } from '@playwright/test';

import { ESTADO_SITE, USUARIOS } from '../apoio/ambiente.js';
import { apiComo, criarUsuarioPronto } from '../apoio/api.js';
import { entrarNoSite } from '../apoio/site.js';

// Redefinição de senha pelo painel e Minha conta no site (plano redefinir-senha-minha-conta, ADR 0013). Os
// usuários são criados só para estes cenários: as senhas dos usuários do seed não mudam.

const SUFIXO = Date.now().toString(36);
const ALVO = {
  email: `senha-site-${SUFIXO}.e2e@exemplo.com`,
  nome: `Pessoa Senha Site ${SUFIXO}`,
  permissoes: ['artes'],
};
const SO_PERMISSOES = {
  email: `permissoes-site-${SUFIXO}.e2e@exemplo.com`,
  nome: `Pessoa Permissões Site ${SUFIXO}`,
  permissoes: ['usuarios', 'usuarios.permissoes'],
};
const SENHA_PRONTA = 'senha-pronta-site-123';
const TEMPORARIA = '1234567890';
const DEFINIDA = 'senha-definida-site-456';
const NOVA = 'senha-conta-site-789';

test.describe.serial('redefinição de senha e Minha conta (site)', () => {
  let alvoId = '';

  test.beforeAll(async () => {
    const admin = await apiComo(USUARIOS.admin);
    try {
      alvoId = await criarUsuarioPronto(admin, ALVO, SENHA_PRONTA);
      await criarUsuarioPronto(admin, SO_PERMISSOES, SENHA_PRONTA);
    } finally {
      await admin.fechar();
    }
  });

  test.describe('como administrador', () => {
    test.use({ storageState: ESTADO_SITE.admin });

    test('redefine a senha de outro usuário; na própria edição não há o card', async ({ page }) => {
      await page.goto(`/aba/usuarios/${alvoId}`);
      await expect(page.getByRole('heading', { name: 'Redefinir senha' })).toBeVisible();

      // Olhinho: alterna entre mostrar e ocultar.
      const nova = page.locator('#redefinir-nova');
      await expect(nova).toHaveAttribute('type', 'password');
      const olho = page.locator('button[aria-controls="redefinir-nova"]');
      await expect(olho).toHaveAccessibleName('Mostrar senha');
      await olho.click();
      await expect(nova).toHaveAttribute('type', 'text');
      await expect(olho).toHaveAttribute('aria-pressed', 'true');
      await expect(olho).toHaveAccessibleName('Ocultar senha');
      await olho.click();
      await expect(nova).toHaveAttribute('type', 'password');

      const enviar = page.getByRole('button', { name: 'Redefinir senha', exact: true });
      await nova.fill('123456789');
      await page.locator('#redefinir-confirmacao').fill('123456789');
      await enviar.click();
      await expect(page.getByText('A senha precisa de ao menos 10 caracteres.')).toBeVisible();

      await nova.fill(TEMPORARIA);
      await page.locator('#redefinir-confirmacao').fill('1234567899');
      await enviar.click();
      await expect(page.getByText('A confirmação não confere com a nova senha.')).toBeVisible();

      await page.locator('#redefinir-confirmacao').fill(TEMPORARIA);
      await enviar.click();
      await expect(page.getByRole('status')).toHaveText(
        'Senha redefinida. O usuário vai trocá-la no próximo acesso.',
      );
      await expect(nova).toHaveValue('');

      await page.goto('/aba/usuarios');
      await page.getByRole('link', { name: 'Editar Admin Fictício' }).click();
      await expect(page.getByRole('heading', { name: 'Dados' })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Redefinir senha' })).toHaveCount(0);
    });
  });

  test('o usuário entra com a senha temporária e é obrigado a trocá-la', async ({ page }) => {
    await page.goto('/entrar');
    await page.getByLabel('E-mail').fill(ALVO.email);
    await page.getByLabel('Senha').fill(SENHA_PRONTA);
    await page.getByRole('button', { name: 'Entrar' }).click();
    await expect(page.locator('main').getByRole('alert')).toHaveText('E-mail ou senha inválidos.');

    await entrarNoSite(page, ALVO.email, TEMPORARIA, /\/trocar-senha/);
    await page.locator('#senhaAtual').fill(TEMPORARIA);
    await page.locator('#novaSenha').fill(DEFINIDA);
    await page.locator('#confirmacao').fill(DEFINIDA);
    await page.getByRole('button', { name: /trocar/i }).click();
    await expect(page).toHaveURL(/\/aba\/artes/);
  });

  test('Minha conta: olhinho, recusas e troca da própria senha', async ({ page }) => {
    await entrarNoSite(page, ALVO.email, DEFINIDA);
    await page.getByRole('link', { name: ALVO.nome }).click();
    await expect(page).toHaveURL(/\/aba\/conta$/);
    await expect(page.getByRole('heading', { name: 'Minha conta' })).toBeVisible();
    await expect(page.getByText(ALVO.email)).toBeVisible();
    await expect(page.getByRole('link', { name: ALVO.nome })).toHaveAttribute(
      'aria-current',
      'page',
    );

    const atual = page.locator('#senhaAtual');
    const olho = page.locator('button[aria-controls="senhaAtual"]');
    await atual.fill('qualquer');
    await olho.click();
    await expect(atual).toHaveAttribute('type', 'text');
    await olho.click();
    await expect(atual).toHaveAttribute('type', 'password');

    const trocar = async (senhaAtual: string, nova: string, confirmacao: string) => {
      await atual.fill(senhaAtual);
      await page.locator('#novaSenha').fill(nova);
      await page.locator('#confirmacao').fill(confirmacao);
      await page.getByRole('button', { name: 'Trocar senha' }).click();
    };

    await trocar('senha-errada-000', NOVA, NOVA);
    await expect(page).toHaveURL(/\/aba\/conta\?erro=senha_atual_incorreta$/);
    await expect(page.locator('main').getByRole('alert')).toHaveText('Senha atual incorreta.');

    await trocar(DEFINIDA, NOVA, 'outra-senha-000');
    await expect(page).toHaveURL(/\/aba\/conta\?erro=confirmacao$/);
    await expect(page.locator('main').getByRole('alert')).toHaveText(
      'A confirmação não confere com a nova senha.',
    );

    await trocar(DEFINIDA, NOVA, NOVA);
    await expect(page).toHaveURL(/\/aba\/conta\?ok=1$/);
    await expect(page.getByRole('status')).toHaveText('Senha alterada.');

    // A sessão continua; a senha nova vale no próximo login.
    await page.goto('/aba/conta');
    await expect(page.getByRole('heading', { name: 'Minha conta' })).toBeVisible();
    await page.context().clearCookies();
    await entrarNoSite(page, ALVO.email, NOVA);
  });

  test('quem só edita permissões abre o usuário, mas não vê o card de redefinição', async ({
    page,
  }) => {
    await entrarNoSite(page, SO_PERMISSOES.email, SENHA_PRONTA, /\/aba\/usuarios/);
    await page.goto(`/aba/usuarios/${alvoId}`);
    await expect(page.getByRole('heading', { name: 'Permissões' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Redefinir senha' })).toHaveCount(0);
  });
});

test('quem não tem permissão nenhuma também abre a Minha conta', async ({ page }) => {
  await entrarNoSite(page, USUARIOS.semAcesso, undefined, /\/aba$/);
  await page.locator('.menu-rodape a.usuario').click();
  await expect(page).toHaveURL(/\/aba\/conta$/);
  await expect(page.getByRole('heading', { name: 'Minha conta' })).toBeVisible();
  await expect(page.getByText(USUARIOS.semAcesso)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Trocar senha' })).toBeVisible();
});
