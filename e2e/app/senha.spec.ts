import { expect, type Page, test } from '@playwright/test';

import { USUARIOS } from '../apoio/ambiente.js';
import { apiComo, criarUsuarioPronto } from '../apoio/api.js';
import { abrirAba, abrirApp, abrirAppLogado, entrarNoApp } from '../apoio/app.js';

// Redefinição de senha pelo painel e Minha conta no app (plano redefinir-senha-minha-conta, ADR 0013). Os
// usuários são criados só para estes cenários: as senhas dos usuários do seed não mudam.

const SUFIXO = Date.now().toString(36);
const ALVO = {
  email: `senha-app-${SUFIXO}.e2e@exemplo.com`,
  nome: `Pessoa Senha App ${SUFIXO}`,
  permissoes: ['artes'],
};
const SO_PERMISSOES = {
  email: `permissoes-app-${SUFIXO}.e2e@exemplo.com`,
  nome: `Pessoa Permissões App ${SUFIXO}`,
  permissoes: ['usuarios', 'usuarios.permissoes'],
};
const SENHA_PRONTA = 'senha-pronta-app-123';
const TEMPORARIA = '1234567890';
const DEFINIDA = 'senha-definida-app-456';
const NOVA = 'senha-conta-app-789';

async function editarNoApp(janela: Page, nome: string) {
  await abrirAba(janela, 'Usuários');
  await janela
    .locator('#usuarios-raiz')
    .getByRole('button', { name: `Editar ${nome}` })
    .click();
}

test.describe.serial('redefinição de senha e Minha conta (app)', () => {
  test.beforeAll(async () => {
    const admin = await apiComo(USUARIOS.admin);
    try {
      await criarUsuarioPronto(admin, ALVO, SENHA_PRONTA);
      await criarUsuarioPronto(admin, SO_PERMISSOES, SENHA_PRONTA);
    } finally {
      await admin.fechar();
    }
  });

  test('admin redefine a senha de outro usuário; na própria edição não há o card', async () => {
    const { app, janela } = await abrirAppLogado(USUARIOS.admin);
    try {
      await editarNoApp(janela, ALVO.nome);
      const raiz = janela.locator('#usuarios-raiz');
      await expect(raiz.getByRole('heading', { name: 'Redefinir senha' })).toBeVisible();

      const nova = raiz.locator('#redefinir-nova');
      const olho = raiz.locator('button[aria-controls="redefinir-nova"]');
      await expect(nova).toHaveAttribute('type', 'password');
      await expect(olho).toHaveAccessibleName('Mostrar senha');
      await olho.click();
      await expect(nova).toHaveAttribute('type', 'text');
      await expect(olho).toHaveAttribute('aria-pressed', 'true');
      await olho.click();
      await expect(nova).toHaveAttribute('type', 'password');

      const enviar = raiz.getByRole('button', { name: 'Redefinir senha', exact: true });
      await nova.fill(TEMPORARIA);
      await raiz.locator('#redefinir-confirmacao').fill('1234567899');
      await enviar.click();
      await expect(raiz.getByText('A confirmação não confere com a nova senha.')).toBeVisible();

      await raiz.locator('#redefinir-confirmacao').fill(TEMPORARIA);
      await enviar.click();
      await expect(
        raiz.getByText('Senha redefinida. O usuário vai trocá-la no próximo acesso.'),
      ).toBeVisible();
      await expect(nova).toHaveValue('');

      await raiz.getByRole('button', { name: '← Usuários' }).click();
      await raiz.getByRole('button', { name: 'Editar Admin Fictício' }).click();
      await expect(raiz.getByRole('button', { name: 'Salvar dados' })).toBeVisible();
      await expect(raiz.getByRole('heading', { name: 'Redefinir senha' })).toHaveCount(0);
    } finally {
      await app.close();
    }
  });

  test('o usuário entra com a senha temporária, troca e usa a Minha conta', async () => {
    const { app, janela } = await abrirApp();
    try {
      await janela.locator('#login-email').fill(ALVO.email);
      await janela.locator('#login-senha').fill(TEMPORARIA);
      await janela.locator('#login-entrar').click();
      await expect(janela.locator('#troca-senha')).toBeVisible({ timeout: 20_000 });
      await janela.locator('#troca-senha-atual').fill(TEMPORARIA);
      await janela.locator('#troca-senha-nova').fill(DEFINIDA);
      await janela.locator('#troca-senha-confirmacao').fill(DEFINIDA);
      await janela.locator('#troca-senha-enviar').click();
      await expect(janela.locator('#app')).toBeVisible({ timeout: 20_000 });

      // Minha conta pelo nome no rodapé do menu.
      await expect(janela.locator('#menu #usuario-nome')).toHaveText(ALVO.nome);
      await janela.locator('#abrir-conta').click();
      const conta = janela.locator('section[data-aba="conta"]');
      await expect(conta).toBeVisible();
      await expect(janela.locator('section[data-aba="artes"]')).toBeHidden();
      await expect(janela.locator('#abrir-conta')).toHaveAttribute('aria-current', 'page');
      await expect(conta.locator('#conta-nome')).toHaveText(ALVO.nome);
      await expect(conta.locator('#conta-email')).toHaveText(ALVO.email);

      const atual = conta.locator('#conta-senha-atual');
      const olho = conta.locator('button[aria-controls="conta-senha-atual"]');
      await atual.fill('qualquer');
      await olho.click();
      await expect(atual).toHaveAttribute('type', 'text');
      await olho.click();
      await expect(atual).toHaveAttribute('type', 'password');

      const status = conta.locator('#conta-senha-status');
      const trocar = async (senhaAtual: string, novaSenha: string, confirmacao: string) => {
        await atual.fill(senhaAtual);
        await conta.locator('#conta-senha-nova').fill(novaSenha);
        await conta.locator('#conta-senha-confirmacao').fill(confirmacao);
        await conta.locator('#conta-senha-enviar').click();
      };

      await trocar('senha-errada-000', NOVA, NOVA);
      await expect(status).toHaveText('Senha atual incorreta.');
      await trocar(DEFINIDA, NOVA, 'outra-senha-000');
      await expect(status).toHaveText('A confirmação não confere com a nova senha.');
      await trocar(DEFINIDA, NOVA, NOVA);
      await expect(status).toHaveText('Senha alterada.');
      await expect(atual).toHaveValue('');

      // Voltar leva à aba que estava aberta.
      await conta.locator('#conta-voltar').click();
      await expect(conta).toBeHidden();
      await expect(janela.locator('section[data-aba="artes"]')).toBeVisible();

      // A senha nova vale no próximo login.
      await janela.locator('#sair').click();
      await expect(janela.locator('#login')).toBeVisible();
      await entrarNoApp(janela, ALVO.email, NOVA);
    } finally {
      await app.close();
    }
  });

  test('quem só edita permissões abre o usuário, mas não vê o card de redefinição', async () => {
    const { app, janela } = await abrirApp();
    try {
      await entrarNoApp(janela, SO_PERMISSOES.email, SENHA_PRONTA);
      await editarNoApp(janela, ALVO.nome);
      const raiz = janela.locator('#usuarios-raiz');
      await expect(raiz.getByRole('heading', { name: 'Permissões' })).toBeVisible();
      await expect(raiz.getByRole('heading', { name: 'Redefinir senha' })).toHaveCount(0);
    } finally {
      await app.close();
    }
  });
});

test('quem não tem permissão nenhuma também abre a Minha conta e volta ao aviso', async () => {
  const { app, janela } = await abrirAppLogado(USUARIOS.semAcesso);
  try {
    await expect(janela.locator('#sem-acesso')).toBeVisible();
    await janela.locator('#abrir-conta').click();
    await expect(janela.locator('section[data-aba="conta"]')).toBeVisible();
    await expect(janela.locator('#sem-acesso')).toBeHidden();
    await janela.locator('#conta-voltar').click();
    await expect(janela.locator('section[data-aba="conta"]')).toBeHidden();
    await expect(janela.locator('#sem-acesso')).toBeVisible();
  } finally {
    await app.close();
  }
});
