import { expect, test } from '@playwright/test';

import { USUARIOS } from '../apoio/ambiente.js';
import { abrirAppLogado, escolherArquivoNoDialogo } from '../apoio/app.js';
import {
  abrirClienteNoApp,
  abrirNovaArteNoApp,
  conferirArteCadastrada,
  novaCorNoApp,
  raizArtes,
} from '../apoio/app-artes.js';
import { arquivoTemporario, PDF_MINIMO, PNG_1X1 } from '../apoio/arquivos.js';
import { nomeDoCliente } from '../apoio/dados.js';

// Artes no app: busca, cadastro com o diálogo de arquivo simulado, Ultra, "Nova cor" e 2.11.

test('admin: busca, cadastra com Ultra e "Nova cor"; "4X4" só seleciona a existente', async () => {
  const { app, janela } = await abrirAppLogado(USUARIOS.admin);
  try {
    const raiz = raizArtes(janela);
    // 2.1 no app: busca sem acento.
    await raiz.getByLabel('Buscar cliente').fill('acai tropical 014');
    await expect(raiz.locator('button.artes-item')).toHaveCount(1);
    await expect(raiz.locator('button.artes-item')).toContainText(nomeDoCliente(13));

    const cliente = nomeDoCliente(24);
    await abrirClienteNoApp(janela, cliente);
    await expect(raiz.getByText('Nenhuma arte cadastrada para este cliente.')).toBeVisible();
    await abrirNovaArteNoApp(janela, 'Rótulo Adesivo');

    // Sem nada marcado: os erros aparecem ao lado dos campos.
    await raiz.getByRole('button', { name: 'Salvar' }).click();
    await expect(raiz.getByRole('alert').filter({ hasText: 'Selecione uma cor.' })).toBeVisible();
    await expect(
      raiz.getByRole('alert').filter({ hasText: 'Selecione ao menos uma máquina.' }),
    ).toBeVisible();
    await expect(
      raiz.getByRole('alert').filter({ hasText: 'Envie ao menos um arquivo.' }),
    ).toBeVisible();

    await escolherArquivoNoDialogo(app, arquivoTemporario('arte-app.pdf', PDF_MINIMO));
    await raiz.getByRole('button', { name: 'Escolher PDF…' }).click();
    await expect(raiz.getByText(/^arte-app\.pdf \(/)).toBeVisible();

    await raiz.getByRole('checkbox', { name: 'Ultra', exact: true }).check();
    const radios = raiz.getByRole('radio');
    const antes = await radios.count();
    await novaCorNoApp(janela, 'Laranja App E2E');
    await expect(raiz.getByRole('radio', { name: 'Laranja App E2E' })).toBeChecked();
    await expect(radios).toHaveCount(antes + 1);
    await novaCorNoApp(janela, '4X4', true);
    await expect(raiz.getByRole('radio', { name: '4x4', exact: true })).toBeChecked();
    await expect(radios).toHaveCount(antes + 1);

    await raiz.getByRole('radio', { name: 'Laranja App E2E' }).check();
    await raiz.getByRole('button', { name: 'Salvar' }).click();
    await conferirArteCadastrada(janela, 'Rótulo Adesivo', '1 arte');
  } finally {
    await app.close();
  }
});

test('2.11 arquivo com a extensão trocada é recusado no app', async () => {
  const { app, janela } = await abrirAppLogado(USUARIOS.admin);
  try {
    const raiz = raizArtes(janela);
    await abrirClienteNoApp(janela, nomeDoCliente(26));
    await abrirNovaArteNoApp(janela, 'Copo de Papel');
    // Uma imagem PNG com nome de PDF: o tipo vem dos bytes, não da extensão.
    await escolherArquivoNoDialogo(app, arquivoTemporario('disfarcado.pdf', PNG_1X1));
    await raiz.getByRole('button', { name: 'Escolher PDF…' }).click();
    await expect(raiz.getByText(/^disfarcado\.pdf \(/)).toBeVisible();
    await raiz.getByRole('checkbox', { name: 'Favorit', exact: true }).check();
    await raiz.getByRole('radio', { name: '4x0', exact: true }).check();
    await raiz.getByRole('button', { name: 'Salvar' }).click();
    await expect(
      raiz.getByRole('alert').filter({ hasText: 'O arquivo precisa ser um PDF.' }),
    ).toBeVisible();
    await expect(raiz.locator('.artes-sucesso')).toHaveCount(0);
  } finally {
    await app.close();
  }
});

test('arte-finalista cadastra com imagem e Ultra junto com outra máquina', async () => {
  const { app, janela } = await abrirAppLogado(USUARIOS.finalista);
  try {
    const raiz = raizArtes(janela);
    await abrirClienteNoApp(janela, nomeDoCliente(27));
    await abrirNovaArteNoApp(janela, 'Envelope Lacrável');
    await escolherArquivoNoDialogo(app, arquivoTemporario('arte-app.png', PNG_1X1));
    await raiz.getByRole('button', { name: 'Escolher Imagem…' }).click();
    // O rótulo do Nome não é ligado ao campo no app: o placeholder identifica.
    await raiz.getByPlaceholder('Padrão').fill('Versão finalista');
    await raiz.getByRole('checkbox', { name: 'Ultra', exact: true }).check();
    await raiz.getByRole('checkbox', { name: 'Rekord', exact: true }).check();
    await raiz.getByRole('radio', { name: '4x4', exact: true }).check();
    await raiz.getByRole('button', { name: 'Salvar' }).click();
    await conferirArteCadastrada(janela, 'Envelope Lacrável', '1 arte');
  } finally {
    await app.close();
  }
});
