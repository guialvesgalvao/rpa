import { expect, type Page, test } from '@playwright/test';

import { ESTADO_SITE, USUARIOS } from '../apoio/ambiente.js';
import { apiComo, artesDoProduto, produtosDoCliente } from '../apoio/api.js';
import { clienteDoSeed } from '../apoio/site-artes.js';
import { entrarNoSite } from '../apoio/site.js';

// Permissões e empresas: 2.13 de testes-manuais-pendentes, Usuários, troca de empresa e o que cada conjunto de
// permissões vê no site (ADR 0011).

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

test('quem só tem o módulo Usuários abre na lista de usuários e não alcança Artes', async ({
  page,
}) => {
  await entrarNoSite(page, USUARIOS.soUsuarios, undefined, /\/aba\/usuarios/);
  const abas = page.getByRole('navigation', { name: 'Abas' });
  await expect(abas.getByRole('link', { name: 'Usuários' })).toBeVisible();
  await expect(abas.getByRole('link', { name: 'Artes' })).toHaveCount(0);
  await expect(page.getByRole('cell', { name: USUARIOS.soUsuarios })).toBeVisible();
  // Só vê a lista: criar exige "Editar e excluir usuários".
  await expect(page.getByRole('heading', { name: 'Novo usuário' })).toHaveCount(0);

  await page.goto('/aba/artes');
  await expect(page.getByRole('heading', { name: 'Página não encontrada' }).first()).toBeVisible();
});

test('quem ainda não tem permissão nenhuma vê o aviso de sem acesso', async ({ page }) => {
  await entrarNoSite(page, USUARIOS.semAcesso, undefined, /\/aba$/);
  await expect(page.getByRole('status')).toHaveText(
    'Você ainda não tem acesso a nenhum módulo nesta empresa.',
  );
  await expect(page.getByRole('navigation', { name: 'Abas' }).getByRole('link')).toHaveCount(0);
});

// Painel de usuários: o ciclo inteiro de um usuário fictício, em ordem (criar, editar, tirar uma permissão,
// conferir o que ele vê, excluir e conferir que não entra mais).
test.describe.serial('painel de usuários', () => {
  const EMAIL = 'nova.e2e@exemplo.com';
  const SENHA_INICIAL = 'senha-inicial-e2e-123';
  const SENHA_NOVA = 'senha-nova-painel-e2e-789';
  const permissoesNaAba = (page: Page) =>
    page.getByRole('group', { name: 'Permissões em ABA Embalagens' });

  test.describe('como administrador', () => {
    test.use({ storageState: ESTADO_SITE.admin });

    test('cria um usuário com área e permissões', async ({ page }) => {
      await page.goto('/aba/usuarios');
      await page.getByLabel('Nome', { exact: true }).fill('Pessoa Fictícia E2E');
      await page.getByLabel('E-mail').fill(EMAIL);
      await page.getByRole('group', { name: 'Empresas' }).getByLabel('ABA Embalagens').check();
      await page.getByLabel('Senha inicial').fill(SENHA_INICIAL);

      // A área é obrigatória no formulário.
      await page.getByRole('button', { name: 'Criar usuário' }).click();
      await expect(page.getByText('Escolha a área.')).toBeVisible();
      await page.getByLabel('Área').selectOption({ label: 'Produção' });

      // Subpermissão só com o módulo marcado.
      const permissoes = permissoesNaAba(page);
      await expect(permissoes.getByLabel('Pode adicionar novas')).toBeDisabled();
      await permissoes.getByLabel('Artes', { exact: true }).check();
      await permissoes.getByLabel('Pode adicionar novas').check();
      await permissoes.getByLabel('Usuários', { exact: true }).check();
      // Compras só existe na empresa com sincronização do Bling (Roma).
      await expect(permissoes.getByLabel('Compras', { exact: true })).toHaveCount(0);

      await page.getByRole('button', { name: 'Criar usuário' }).click();
      await expect(page.getByRole('status')).toContainText(`Usuário ${EMAIL} criado`);
      const linha = page.getByRole('row').filter({ hasText: EMAIL });
      await expect(linha.getByRole('cell', { name: 'Produção' })).toBeVisible();
    });

    test('edita nome e área e tira a permissão de Artes', async ({ page }) => {
      await page.goto('/aba/usuarios');
      await page.getByRole('link', { name: 'Editar Pessoa Fictícia E2E' }).click();
      await expect(page).toHaveURL(/\/aba\/usuarios\/[0-9a-f-]{36}$/);

      await page.getByLabel('Nome', { exact: true }).fill('Pessoa Editada E2E');
      await page.getByLabel('Área').selectOption({ label: 'Direção' });
      await page.getByRole('button', { name: 'Salvar dados' }).click();
      await expect(page.getByRole('status')).toHaveText('Dados salvos.');
      await expect(page.getByRole('heading', { name: 'Pessoa Editada E2E' })).toBeVisible();

      const permissoes = permissoesNaAba(page);
      await expect(permissoes.getByLabel('Pode adicionar novas')).toBeChecked();
      await permissoes.getByLabel('Artes', { exact: true }).uncheck();
      // Desmarcar o módulo leva a subpermissão junto.
      await expect(permissoes.getByLabel('Pode adicionar novas')).not.toBeChecked();
      await page.getByRole('button', { name: 'Salvar permissões em ABA Embalagens' }).click();
      await expect(page.getByText('Permissões em ABA Embalagens salvas.')).toBeVisible();

      await page.goto('/aba/usuarios');
      const linha = page.getByRole('row').filter({ hasText: EMAIL });
      await expect(
        linha.getByRole('cell', { name: 'Pessoa Editada E2E', exact: true }),
      ).toBeVisible();
      await expect(linha.getByRole('cell', { name: 'Direção' })).toBeVisible();
    });
  });

  test('o usuário criado troca a senha e só vê Usuários', async ({ page }) => {
    await entrarNoSite(page, EMAIL, SENHA_INICIAL, /\/trocar-senha/);
    await page.locator('#senhaAtual').fill(SENHA_INICIAL);
    await page.locator('#novaSenha').fill(SENHA_NOVA);
    await page.locator('#confirmacao').fill(SENHA_NOVA);
    await page.getByRole('button', { name: /trocar/i }).click();
    await expect(page).toHaveURL(/\/aba\/usuarios$/);

    const abas = page.getByRole('navigation', { name: 'Abas' });
    await expect(abas.getByRole('link', { name: 'Usuários' })).toBeVisible();
    await expect(abas.getByRole('link', { name: 'Artes' })).toHaveCount(0);
    // Só o módulo, sem subpermissão: vê a lista, não edita ninguém.
    await expect(page.getByRole('link', { name: /^Editar / })).toHaveCount(0);
  });

  test.describe('como administrador, de novo', () => {
    test.use({ storageState: ESTADO_SITE.admin });

    test('exclui o usuário e não pode excluir a si mesmo', async ({ page }) => {
      await page.goto('/aba/usuarios');
      await page.getByRole('link', { name: 'Editar Admin Fictício' }).click();
      await expect(page.getByRole('heading', { name: 'Dados' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Excluir usuário' })).toHaveCount(0);

      await page.goto('/aba/usuarios');
      await page.getByRole('link', { name: 'Editar Pessoa Editada E2E' }).click();
      page.once('dialog', (dialogo) => void dialogo.accept());
      await page.getByRole('button', { name: 'Excluir usuário' }).click();
      await expect(page).toHaveURL(/\/aba\/usuarios\?excluido=1$/);
      await expect(page.getByRole('status')).toHaveText('Usuário excluído');
      await expect(page.getByRole('cell', { name: EMAIL })).toHaveCount(0);
    });
  });

  test('o usuário excluído não entra mais', async ({ page }) => {
    await page.goto('/entrar');
    await page.getByLabel('E-mail').fill(EMAIL);
    await page.getByLabel('Senha').fill(SENHA_NOVA);
    await page.getByRole('button', { name: 'Entrar' }).click();
    await expect(page.locator('main').getByRole('alert')).toHaveText('E-mail ou senha inválidos.');
  });
});
