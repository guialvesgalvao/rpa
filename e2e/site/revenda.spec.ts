import { expect, test } from '@playwright/test';

import { ESTADO_SITE } from '../apoio/ambiente.js';
import { REVENDA, TITULO_TAREFA_REVENDA } from '../apoio/dados.js';

// Cliente final de revenda (ADR 0017), com o revendedor fictício da Roma do `semear`.
test.describe('revenda no site', () => {
  test.use({ storageState: ESTADO_SITE.admin });

  test('busca pelo cliente final acha o revendedor; selo e filtro nas artes do produto', async ({
    page,
  }) => {
    await page.goto('/roma/artes');
    await page.getByLabel('Buscar cliente').fill('hamburgueria');
    await expect(page.locator('ul.lista li')).toHaveCount(1);
    await page.getByRole('link', { name: REVENDA.nome }).click();

    const produto = page
      .locator('li.produto-com-artes')
      .filter({ has: page.getByText(REVENDA.produto, { exact: true }) });
    await produto.locator('button.produto-cabecalho').click();
    const artes = produto.getByRole('list', { name: `Artes de ${REVENDA.produto}` });
    await expect(artes.getByRole('listitem')).toHaveCount(3);
    await expect(
      artes.getByText(`Cliente final: ${REVENDA.artes[0].clienteFinal} · Pedido nº 9900`),
    ).toBeVisible();
    await expect(artes.getByText(`Cliente final: ${REVENDA.artes[1].clienteFinal}`)).toBeVisible();

    const filtro = produto.getByLabel('Cliente final');
    await filtro.selectOption({ label: REVENDA.artes[1].clienteFinal });
    await expect(artes.getByRole('listitem')).toHaveCount(1);
    await expect(artes.getByText('Verso', { exact: true })).toBeVisible();
    await filtro.selectOption({ label: 'Sem cliente final' });
    await expect(artes.getByRole('listitem')).toHaveCount(1);
    await expect(artes.getByText('Padrão', { exact: true })).toBeVisible();
    await filtro.selectOption({ label: 'Todos os clientes finais' });
    await expect(artes.getByRole('listitem')).toHaveCount(3);
  });

  test('tarefa de revenda: título com o cliente final e o revendedor, e o campo no detalhe', async ({
    page,
  }) => {
    await page.goto('/roma/artes/tarefas');
    // O nome do link inclui o título e a linha de baixo; casa por trecho.
    const link = page.getByRole('link', { name: TITULO_TAREFA_REVENDA });
    await expect(link).toBeVisible();
    await link.click();
    await expect(page.getByRole('heading', { name: TITULO_TAREFA_REVENDA })).toBeVisible();
    await expect(page.locator('dl.info-tarefa')).toContainText(
      `Cliente final${REVENDA.tarefa.clienteFinal}`,
    );
  });
});
