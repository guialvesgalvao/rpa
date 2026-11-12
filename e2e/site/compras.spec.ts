import { writeFileSync } from 'node:fs';
import path from 'node:path';

import { type Browser, expect, type Page, test } from '@playwright/test';

import { ESTADO_SITE, USUARIOS } from '../apoio/ambiente.js';
import { pastaTemporaria, PNG_1X1 } from '../apoio/arquivos.js';
import { entrarNoSite } from '../apoio/site.js';

// Compras (ADR 0012), só na Roma: quem só pede cria o pedido; quem acompanha assume, comenta com anexo e conclui;
// o histórico mostra cada evento; outra pessoa que só pede não alcança o pedido. Dados fictícios.

async function entrar(browser: Browser, email: string): Promise<Page> {
  const contexto = await browser.newContext();
  const page = await contexto.newPage();
  await entrarNoSite(page, email, undefined, /\/roma\/compras$/);
  return page;
}

test('pedido de compra: criar, assumir, comentar com anexo, concluir e ver o histórico', async ({
  browser,
}) => {
  const pedro = await entrar(browser, USUARIOS.pedeCompras);
  const olivia = await entrar(browser, USUARIOS.outraPedeCompras);
  const ana = await entrar(browser, USUARIOS.acompanhaCompras);
  try {
    // Quem só pede: o menu mostra Compras; sem o filtro "Todos". Não se assume lista vazia: o spec do app
    // (mesmo banco, mesmo usuário) pode ter deixado pedidos antes deste.
    await expect(
      pedro.getByRole('navigation', { name: 'Abas' }).getByRole('link', { name: 'Compras' }),
    ).toBeVisible();
    await expect(pedro.getByLabel('Pedidos').locator('option')).toHaveText([
      'Meus pedidos',
      'Em aberto',
    ]);

    await pedro.getByRole('link', { name: 'Novo pedido' }).click();
    await pedro.getByLabel('Buscar insumo').fill('tinta');
    await expect(pedro.getByLabel('Insumo', { exact: true })).toHaveValue(/.+/);
    await expect(pedro.getByLabel('Insumo', { exact: true }).locator('option:checked')).toHaveText(
      'TPP0001 — Tinta Preta Fictícia 1 L',
    );
    await pedro.getByLabel('Quantidade').fill('2,5');
    await pedro.getByLabel('Observação (opcional)').fill('Para a linha 2');
    await pedro.getByRole('button', { name: 'Criar pedido' }).click();
    await expect(pedro.getByRole('status')).toHaveText('Pedido criado');
    const caminho = new URL(pedro.url()).pathname;
    await expect(
      pedro.getByRole('heading', { name: 'TPP0001 — Tinta Preta Fictícia 1 L' }),
    ).toBeVisible();
    await expect(pedro.locator('.selo-compra')).toHaveText('Aberta');
    await expect(pedro.getByRole('button', { name: 'Cancelar pedido' })).toBeVisible();
    await expect(pedro.getByRole('button', { name: 'Assumir pedido' })).toHaveCount(0);

    // Outra pessoa que só pede não vê o pedido nem na lista nem pelo endereço.
    await olivia.reload();
    await expect(olivia.getByText('Nenhum pedido encontrado.')).toBeVisible();
    await olivia.goto(caminho);
    await expect(
      olivia.getByRole('heading', { name: 'Página não encontrada' }).first(),
    ).toBeVisible();

    // Quem acompanha vê em "Todos", assume, comenta com anexo e conclui.
    await ana.getByLabel('Pedidos').selectOption({ label: 'Todos' });
    await ana.getByRole('button', { name: 'Filtrar' }).click();
    const linha = ana.getByRole('row', { name: /TPP0001/ });
    await expect(linha).toContainText('2,5');
    await expect(linha).toContainText('Pedro Pedidos E2E');
    await expect(linha).toContainText('Produção');
    await expect(linha).toContainText('Sem responsável');
    await linha.getByRole('link').click();
    await expect(ana).toHaveURL(new RegExp(`${caminho}$`));

    await ana.getByRole('button', { name: 'Assumir pedido' }).click();
    await expect(ana.locator('.selo-compra')).toHaveText('Em andamento');
    await expect(ana.locator('.info-tarefa')).toContainText('Ana Compras E2E');
    await expect(ana.getByRole('button', { name: 'Assumir pedido' })).toHaveCount(0);

    const pasta = pastaTemporaria('compras');
    const arquivo = path.join(pasta, 'cotacao.png');
    writeFileSync(arquivo, PNG_1X1);
    await ana.getByLabel('Novo comentário').fill('Cotação em anexo');
    await ana.getByLabel(/^Anexos/).setInputFiles(arquivo);
    await ana.getByRole('button', { name: 'Comentar' }).click();
    const comentarios = ana.locator('ul.comentarios');
    await expect(comentarios).toContainText('Cotação em anexo');
    await expect(comentarios.getByRole('link', { name: 'cotacao.png' })).toBeVisible();

    await ana.getByLabel('Mudar status').selectOption('concluida');
    await expect(ana.locator('.selo-compra')).toHaveText('Concluída');
    await expect(ana.getByRole('button', { name: 'Editar pedido' })).toHaveCount(0);

    await ana.getByRole('link', { name: 'Histórico' }).click();
    const mudancas = ana.locator('table.tabela-historico tbody tr td:nth-child(2)');
    await expect(mudancas).toHaveText([
      'Pedido criado',
      'Responsável: Ana Compras E2E',
      'Aberta → Em andamento',
      'Em andamento → Concluída',
    ]);

    // O criador vê o pedido concluído, com o comentário e sem as ações de edição.
    await pedro.reload();
    await expect(pedro.locator('.selo-compra')).toHaveText('Concluída');
    await expect(pedro.locator('ul.comentarios')).toContainText('Cotação em anexo');
    await expect(pedro.getByRole('button', { name: 'Cancelar pedido' })).toHaveCount(0);
  } finally {
    for (const page of [pedro, olivia, ana]) await page.context().close();
  }
});

test('criador edita o pedido aberto e cancela', async ({ browser }) => {
  const pedro = await entrar(browser, USUARIOS.pedeCompras);
  try {
    await pedro.getByRole('link', { name: 'Novo pedido' }).click();
    await pedro
      .getByLabel('Insumo', { exact: true })
      .selectOption({ label: 'TPP0002 — Cola Branca Fictícia 5 kg' });
    await pedro.getByLabel('Quantidade').fill('10');
    await pedro.getByRole('button', { name: 'Criar pedido' }).click();
    await expect(pedro.getByRole('status')).toHaveText('Pedido criado');

    await pedro.getByRole('button', { name: 'Editar pedido' }).click();
    await pedro.getByLabel('Quantidade').fill('12');
    await pedro.getByRole('button', { name: 'Salvar alterações' }).click();
    // O primeiro dado é a quantidade.
    await expect(pedro.locator('.info-tarefa dd').first()).toHaveText('12');

    pedro.once('dialog', (dialogo) => void dialogo.accept());
    await pedro.getByRole('button', { name: 'Cancelar pedido' }).click();
    await expect(pedro.locator('.selo-compra')).toHaveText('Cancelada');

    await pedro.getByRole('link', { name: 'Histórico' }).click();
    await expect(pedro.locator('table.tabela-historico tbody tr td:nth-child(2)')).toHaveText([
      'Pedido criado',
      'Quantidade: 10 → 12',
      'Aberta → Cancelada',
    ]);
  } finally {
    await pedro.context().close();
  }
});

test.describe('admin', () => {
  test.use({ storageState: ESTADO_SITE.admin });

  test('Compras aparece só na Roma; na ABA a página não existe', async ({ page }) => {
    await page.goto('/roma/artes');
    const abas = page.getByRole('navigation', { name: 'Abas' });
    await expect(abas.getByRole('link', { name: 'Compras' })).toBeVisible();
    await page.goto('/aba/artes');
    await expect(abas.getByRole('link', { name: 'Artes' })).toBeVisible();
    await expect(abas.getByRole('link', { name: 'Compras' })).toHaveCount(0);
    await page.goto('/aba/compras');
    await expect(
      page.getByRole('heading', { name: 'Página não encontrada' }).first(),
    ).toBeVisible();
  });
});
