import { expect, test } from '@playwright/test';

import { ESTADO_SITE, USUARIOS } from '../apoio/ambiente.js';
import { apiComo, clientePorNome } from '../apoio/api.js';
import {
  CLIENTES_POR_EMPRESA,
  PRIMEIRO_SEM_ARTE,
  mascararCnpj,
  nomeDoCliente,
} from '../apoio/dados.js';

// Itens 2.1 a 2.5 de testes-manuais-pendentes (lista e página do cliente), com os dois perfis.
for (const perfil of ['admin', 'finalista'] as const) {
  test.describe(`clientes no site (${perfil})`, () => {
    test.use({ storageState: ESTADO_SITE[perfil] });

    test('2.1 busca por nome sem acento acha o cliente com acento', async ({ page }) => {
      const nome = nomeDoCliente(13); // "Confeitaria Açaí Tropical 014"
      await page.goto('/aba/artes');
      await page.getByLabel('Buscar cliente').fill('acai tropical 014');
      await expect(page.locator('ul.lista li')).toHaveCount(1);
      await expect(page.getByRole('link', { name: nome })).toBeVisible();
    });

    test('2.2 busca por CNPJ com máscara acha o mesmo cliente', async ({ page }) => {
      const nome = nomeDoCliente(13);
      const api = await apiComo(USUARIOS.admin);
      const cliente = await clientePorNome(api, 'aba', nome);
      await api.fechar();
      await page.goto('/aba/artes');
      await page.getByLabel('Buscar cliente').fill(mascararCnpj(cliente.cnpj));
      await expect(page.locator('ul.lista li')).toHaveCount(1);
      await expect(page.getByRole('link', { name: nome })).toBeVisible();
    });

    test('2.3 rolar até o fim carrega de 20 em 20, sem repetição', async ({ page }) => {
      await page.goto('/aba/artes');
      const itens = page.locator('ul.lista li');
      await expect(itens).toHaveCount(20);
      for (const esperado of [40, CLIENTES_POR_EMPRESA]) {
        await itens.last().scrollIntoViewIfNeeded();
        await page.mouse.wheel(0, 5_000);
        await expect(itens).toHaveCount(esperado);
      }
      // Fim da lista: rolar de novo não traz mais nada nem mostra erro.
      await page.mouse.wheel(0, 5_000);
      await expect(page.locator('main').getByRole('alert')).toHaveCount(0);
      await expect(itens).toHaveCount(CLIENTES_POR_EMPRESA);
      const nomes = await page
        .locator('ul.lista li a')
        .evaluateAll((links) => links.map((link) => link.getAttribute('href')));
      expect(new Set(nomes).size).toBe(CLIENTES_POR_EMPRESA);
    });

    test('2.4 cliente com artes mostra o contador por produto', async ({ page }) => {
      // O 4º cliente do seed tem 3 produtos com arte.
      const api = await apiComo(USUARIOS.admin);
      const cliente = await clientePorNome(api, 'aba', nomeDoCliente(3));
      await api.fechar();
      await page.goto(`/aba/artes/clientes/${cliente.id}`);
      const contadores = page.locator('ul.lista li .status');
      await expect(contadores).toHaveCount(3);
      for (const texto of await contadores.allTextContents()) {
        expect(texto).toMatch(/^(1 arte|\d+ artes)$/);
      }
    });

    test('2.5 cliente sem artes mostra o placeholder', async ({ page }) => {
      const api = await apiComo(USUARIOS.admin);
      const cliente = await clientePorNome(api, 'aba', nomeDoCliente(PRIMEIRO_SEM_ARTE + 40));
      await api.fechar();
      await page.goto(`/aba/artes/clientes/${cliente.id}`);
      await expect(page.getByText('Nenhuma arte cadastrada para este cliente.')).toBeVisible();
    });
  });
}
