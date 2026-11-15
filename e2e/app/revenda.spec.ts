import { expect, type Page, test } from '@playwright/test';

import { USUARIOS } from '../apoio/ambiente.js';
import { abrirAba, abrirAppLogado, fecharConfiguracoesSeAbrir } from '../apoio/app.js';
import { raizArtes } from '../apoio/app-artes.js';
import { REVENDA, TITULO_TAREFA_REVENDA } from '../apoio/dados.js';

// Cliente final de revenda (ADR 0017) no app, com o revendedor fictício da Roma do `semear`.

async function irParaArtesDaRoma(janela: Page): Promise<void> {
  await janela.locator('#empresa').click();
  await janela.locator('dialog#empresas').getByRole('button', { name: /Roma/ }).click();
  await fecharConfiguracoesSeAbrir(janela);
  await abrirAba(janela, 'Artes');
}

test('busca pelo cliente final, selo e filtro nas artes; título e campo da tarefa de revenda', async () => {
  const { app, janela } = await abrirAppLogado(USUARIOS.admin);
  try {
    await irParaArtesDaRoma(janela);
    const raiz = raizArtes(janela);

    await raiz.getByLabel('Buscar cliente').fill('hamburgueria');
    await expect(raiz.locator('button.artes-item')).toHaveCount(1);
    await raiz.locator('button.artes-item', { hasText: REVENDA.nome }).click();
    await expect(raiz.getByRole('heading', { name: REVENDA.nome })).toBeVisible();

    const produto = raiz
      .locator('li.produto-com-artes')
      .filter({ has: janela.getByText(REVENDA.produto, { exact: true }) });
    await produto.locator('button.produto-cabecalho').click();
    const artes = produto.getByRole('list', { name: `Artes de ${REVENDA.produto}` });
    await expect(artes.getByRole('listitem')).toHaveCount(3);
    await expect(
      artes.getByText(`Cliente final: ${REVENDA.artes[0].clienteFinal} · Pedido nº 9900`),
    ).toBeVisible();

    const filtro = produto.getByLabel('Cliente final');
    await filtro.selectOption({ label: REVENDA.artes[1].clienteFinal });
    await expect(artes.getByRole('listitem')).toHaveCount(1);
    await expect(artes.getByText('Verso', { exact: true })).toBeVisible();
    await filtro.selectOption({ label: 'Sem cliente final' });
    await expect(artes.getByRole('listitem')).toHaveCount(1);
    await expect(artes.getByText('Padrão', { exact: true })).toBeVisible();

    // Tarefas: o atalho "Todos" lista a tarefa aberta da revenda com o título novo.
    await raiz.getByRole('button', { name: 'Voltar' }).first().click();
    await raiz.getByRole('button', { name: 'Todos', exact: true }).click();
    const item = raiz.locator('button.tarefa-item', { hasText: TITULO_TAREFA_REVENDA });
    await expect(item).toBeVisible();
    await item.click();
    await expect(raiz.getByRole('heading', { name: TITULO_TAREFA_REVENDA })).toBeVisible();
    await expect(raiz.locator('.tarefa-info')).toContainText(
      `Cliente final${REVENDA.tarefa.clienteFinal}`,
    );
  } finally {
    await app.close();
  }
});
