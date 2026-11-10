import { expect, test } from '@playwright/test';

import { USUARIOS } from '../apoio/ambiente.js';
import { apiComo, criarCor } from '../apoio/api.js';
import { abrirAba, abrirApp, abrirAppLogado, fecharConfiguracoesSeAbrir } from '../apoio/app.js';
import { abrirClienteNoApp, abrirNovaArteNoApp, raizArtes } from '../apoio/app-artes.js';
import { nomeDoCliente } from '../apoio/dados.js';

// Cache das cores no app (1 h) e o campo E-mail do cadastro de usuários (plano ultra-cores-observacao-op).

test('cor criada fora do app só aparece depois de reiniciar (cache de 1 h)', async () => {
  test.setTimeout(120_000);
  const cliente = nomeDoCliente(28);
  const primeiro = await abrirAppLogado(USUARIOS.admin);
  const { pastaDados } = primeiro;
  try {
    // Carrega a lista de cores (entra no cache).
    await abrirClienteNoApp(primeiro.janela, cliente);
    await abrirNovaArteNoApp(primeiro.janela, 'Bandeja Térmica');
    await expect(raizArtes(primeiro.janela).getByRole('radio', { name: '4x0' })).toBeVisible();

    // A cor nasce pela API (como no site) enquanto o app está aberto.
    const api = await apiComo(USUARIOS.admin);
    await criarCor(api, 'Roxo Cache E2E');
    await api.fechar();

    await raizArtes(primeiro.janela).getByRole('button', { name: 'Cancelar' }).click();
    await abrirNovaArteNoApp(primeiro.janela, 'Bandeja Térmica');
    await expect(raizArtes(primeiro.janela).getByRole('radio', { name: '4x0' })).toBeVisible();
    await expect(
      raizArtes(primeiro.janela).getByRole('radio', { name: 'Roxo Cache E2E' }),
    ).toHaveCount(0);
  } finally {
    await primeiro.app.close();
  }

  // Reiniciado (mesma pasta, sessão salva): a lista vem de novo do servidor.
  const segundo = await abrirApp({ pastaDados });
  try {
    await expect(segundo.janela.locator('#app')).toBeVisible();
    await fecharConfiguracoesSeAbrir(segundo.janela);
    await abrirClienteNoApp(segundo.janela, cliente);
    await abrirNovaArteNoApp(segundo.janela, 'Bandeja Térmica');
    await expect(
      raizArtes(segundo.janela).getByRole('radio', { name: 'Roxo Cache E2E' }),
    ).toBeVisible();
  } finally {
    await segundo.app.close();
  }
});

test('Usuários: o E-mail tem o mesmo visual e o mesmo foco do Nome; admin cria usuário', async () => {
  const { app, janela } = await abrirAppLogado(USUARIOS.admin);
  try {
    await abrirAba(janela, 'Usuários');
    const raiz = janela.locator('#usuarios-raiz');
    const nome = raiz.locator('#usuario-nome');
    const email = raiz.locator('#usuario-email');
    await expect(email).toBeVisible();

    const PROPRIEDADES = [
      'height',
      'padding-top',
      'padding-left',
      'font-size',
      'font-family',
      'border-top-width',
      'border-top-style',
      'border-top-color',
      'border-top-left-radius',
      'background-color',
      'color',
    ];
    const estilo = (campo: typeof nome) =>
      campo.evaluate(
        (el, props) => {
          const calculado = getComputedStyle(el);
          return Object.fromEntries(props.map((p) => [p, calculado.getPropertyValue(p)]));
        },
        [...PROPRIEDADES, 'outline-style', 'outline-color', 'box-shadow'],
      );
    const semFoco = (s: Record<string, string>) =>
      Object.fromEntries(PROPRIEDADES.map((p) => [p, s[p]]));
    expect(semFoco(await estilo(email))).toEqual(semFoco(await estilo(nome)));

    await nome.focus();
    const focoNome = await estilo(nome);
    await email.focus();
    const focoEmail = await estilo(email);
    expect(focoEmail).toEqual(focoNome);

    await nome.fill('Pessoa App E2E');
    await email.fill('nova.app.e2e@exemplo.com');
    await raiz.locator('#usuario-senha').fill('senha-inicial-app-123');
    await raiz.getByRole('group', { name: 'Empresas' }).getByRole('checkbox').first().check();
    await raiz.getByRole('button', { name: 'Criar usuário' }).click();
    await expect(raiz.getByRole('status')).toContainText('nova.app.e2e@exemplo.com');
  } finally {
    await app.close();
  }
});
