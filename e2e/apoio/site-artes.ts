import { expect, type Page } from '@playwright/test';

import { USUARIOS } from './ambiente.js';
import { apiComo, type ClienteApi, clientePorNome } from './api.js';
import { nomeDoCliente } from './dados.js';

export async function clienteDoSeed(empresa: string, indice: number): Promise<ClienteApi> {
  const api = await apiComo(USUARIOS.admin);
  try {
    return await clientePorNome(api, empresa, nomeDoCliente(indice));
  } finally {
    await api.fechar();
  }
}

/** Página do cliente → "Novo trabalho de arte" → "Inserir arte pronta" com o produto escolhido. */
export async function abrirNovaArte(
  page: Page,
  empresa: string,
  clienteId: string,
  produto: string,
): Promise<void> {
  await page.goto(`/${empresa}/artes/clientes/${clienteId}`);
  await page.getByLabel('Produto do catálogo').selectOption({ label: produto });
  await page.getByRole('button', { name: 'Inserir arte pronta' }).click();
  await expect(page).toHaveURL(/\/artes\/nova\?/);
  await expect(page.getByLabel('Produto', { exact: true })).toHaveValue(/.+/);
}

export type DadosArte = {
  nome?: string;
  cor: string;
  maquinas: string[];
  pdf?: string;
  imagem?: string;
};

export async function preencherArte(page: Page, dados: DadosArte): Promise<void> {
  if (dados.nome !== undefined) await page.getByLabel('Nome', { exact: true }).fill(dados.nome);
  await page.getByRole('radio', { name: dados.cor, exact: true }).check();
  for (const maquina of dados.maquinas) {
    await page.getByRole('checkbox', { name: maquina, exact: true }).check();
  }
  if (dados.pdf) await page.getByLabel('PDF', { exact: true }).setInputFiles(dados.pdf);
  if (dados.imagem) await page.getByLabel('Imagem', { exact: true }).setInputFiles(dados.imagem);
}

/** Salva e confere a volta para o cliente com "Arte cadastrada" e o contador do produto. */
export async function salvarArte(page: Page, produto: string, contador: string): Promise<void> {
  await page.getByRole('button', { name: 'Salvar' }).click();
  await expect(page.getByRole('status')).toHaveText('Arte cadastrada', { timeout: 30_000 });
  await expect(page.locator('ul.lista li', { hasText: produto }).locator('.status')).toHaveText(
    contador,
  );
}
