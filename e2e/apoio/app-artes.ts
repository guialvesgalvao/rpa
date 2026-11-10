import { expect, type Page } from '@playwright/test';

import { abrirAba } from './app.js';

const raizArtes = (janela: Page) => janela.locator('#artes-raiz');

/** Aba Artes → busca → abre o cliente pelo nome. */
export async function abrirClienteNoApp(janela: Page, nome: string): Promise<void> {
  await abrirAba(janela, 'Artes');
  const busca = raizArtes(janela).getByLabel('Buscar cliente');
  await busca.fill(nome);
  const item = raizArtes(janela).locator('button.artes-item', { hasText: nome });
  await expect(raizArtes(janela).locator('button.artes-item')).toHaveCount(1);
  await item.click();
  await expect(raizArtes(janela).getByRole('heading', { name: nome })).toBeVisible();
}

/** Na página do cliente: "Novo trabalho de arte" → "Inserir arte pronta". */
export async function abrirNovaArteNoApp(janela: Page, produto: string): Promise<void> {
  await raizArtes(janela).getByLabel('Produto do catálogo').selectOption({ label: produto });
  await raizArtes(janela).getByRole('button', { name: 'Inserir arte pronta' }).click();
  await expect(raizArtes(janela).getByRole('heading', { name: /^Nova arte — / })).toBeVisible();
}

/** Contador do produto na página do cliente, depois de salvar. */
export async function conferirArteCadastrada(
  janela: Page,
  produto: string,
  contador: string,
): Promise<void> {
  await expect(raizArtes(janela).locator('.artes-sucesso')).toHaveText('Arte cadastrada', {
    timeout: 30_000,
  });
  await expect(
    raizArtes(janela)
      .locator('.artes-produtos li', { hasText: produto })
      .locator('.artes-contador'),
  ).toHaveText(contador);
}

/** "+ Nova cor" com o nome dado; confirma com o botão ou com Enter. */
export async function novaCorNoApp(janela: Page, nome: string, comEnter = false): Promise<void> {
  const raiz = raizArtes(janela);
  await raiz.getByRole('button', { name: '+ Nova cor' }).click();
  await raiz.getByLabel('Nome da nova cor').fill(nome);
  if (comEnter) await raiz.getByLabel('Nome da nova cor').press('Enter');
  else await raiz.getByRole('button', { name: 'Adicionar' }).click();
}

export { raizArtes };
