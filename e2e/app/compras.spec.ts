import { expect, type Page, test } from '@playwright/test';

import { USUARIOS } from '../apoio/ambiente.js';
import { abrirAba, abrirAppLogado, escolherArquivoNoDialogo } from '../apoio/app.js';
import { arquivoTemporario, PNG_1X1 } from '../apoio/arquivos.js';

// Compras no app (ADR 0012), só na Roma: quem só pede cria; quem acompanha assume, comenta com anexo e conclui; o
// histórico mostra os eventos; outra pessoa que só pede não vê o pedido. Dados fictícios.

const raiz = (janela: Page) => janela.locator('#compras-raiz');

/** Linha da lista pelo insumo e pela quantidade (única por teste). */
const linhaDoPedido = (janela: Page, quantidade: string) =>
  raiz(janela)
    .locator('button.artes-item')
    .filter({ hasText: `Quantidade ${quantidade}` });

async function novoPedido(janela: Page, busca: string, insumo: string, quantidade: string) {
  const compras = raiz(janela);
  await compras.getByRole('button', { name: 'Novo pedido' }).click();
  await compras.getByLabel('Buscar insumo').fill(busca);
  await compras.getByLabel('Insumo', { exact: true }).selectOption({ label: insumo });
  await compras.getByLabel('Quantidade').fill(quantidade);
  await compras.getByLabel('Observação').fill('Pedido do app E2E');
  await compras.getByRole('button', { name: 'Fazer pedido' }).click();
  await expect(compras.locator('.artes-sucesso')).toHaveText('Pedido criado');
}

test('pedido de compra no app: criar, assumir, comentar com anexo, concluir e ver o histórico', async () => {
  test.setTimeout(120_000);
  const insumo = 'TPP0002 — Cola Branca Fictícia 5 kg';

  // Quem só pede: só a aba Compras, sem o filtro "Todos"; cria o pedido.
  const pedro = await abrirAppLogado(USUARIOS.pedeCompras);
  try {
    await abrirAba(pedro.janela, 'Compras');
    const compras = raiz(pedro.janela);
    await expect(compras.getByLabel('Pedidos').locator('option')).toHaveText([
      'Meus pedidos',
      'Em aberto',
    ]);
    await novoPedido(pedro.janela, 'cola', insumo, '7,125');
    await expect(compras.getByRole('heading', { name: `Pedido — ${insumo}` })).toBeVisible();
    await expect(compras.locator('.compra-status')).toHaveText('Aberta');
    await expect(compras.getByRole('button', { name: 'Cancelar pedido' })).toBeVisible();
    await expect(compras.getByRole('button', { name: 'Assumir' })).toHaveCount(0);
  } finally {
    await pedro.app.close();
  }

  // Outra pessoa que só pede não vê o pedido.
  const olivia = await abrirAppLogado(USUARIOS.outraPedeCompras);
  try {
    await abrirAba(olivia.janela, 'Compras');
    await raiz(olivia.janela).getByLabel('Pedidos').selectOption('abertos');
    await expect(raiz(olivia.janela).locator('.artes-situacao')).not.toHaveText('Carregando…');
    await expect(linhaDoPedido(olivia.janela, '7,125')).toHaveCount(0);
  } finally {
    await olivia.app.close();
  }

  // Quem acompanha: acha em "Todos", assume, comenta com anexo e conclui.
  const ana = await abrirAppLogado(USUARIOS.acompanhaCompras);
  try {
    const { app, janela } = ana;
    await abrirAba(janela, 'Compras');
    const compras = raiz(janela);
    await compras.getByLabel('Pedidos').selectOption('todos');
    await linhaDoPedido(janela, '7,125').click();
    await compras.getByRole('button', { name: 'Assumir' }).click();
    await expect(compras.locator('.artes-sucesso')).toHaveText('Pedido assumido');
    await expect(compras.locator('.compra-status')).toHaveText('Em andamento');
    await expect(compras.getByText('Ana Compras E2E', { exact: true })).toBeVisible();

    await escolherArquivoNoDialogo(app, arquivoTemporario('cotacao-app.png', PNG_1X1));
    await compras.getByRole('button', { name: 'Anexar' }).click();
    await expect(compras.getByText(/^cotacao-app\.png \(/)).toBeVisible();
    await compras.getByLabel('Novo comentário').fill('Cotação em anexo');
    await compras.getByRole('button', { name: 'Comentar' }).click();
    const comentario = compras
      .locator('.tarefa-comentario')
      .filter({ hasText: 'Cotação em anexo' });
    await expect(comentario).toContainText('cotacao-app.png');
    await expect(comentario.getByRole('button', { name: 'Baixar' })).toBeVisible();

    await compras.getByLabel('Status do pedido').selectOption('concluida');
    await expect(compras.locator('.artes-sucesso')).toHaveText('Status atualizado');
    await expect(compras.locator('.compra-status')).toHaveText('Concluída');
    // Concluído: não dá mais para assumir nem editar.
    await expect(compras.getByRole('button', { name: 'Assumir' })).toHaveCount(0);
    await expect(compras.getByRole('button', { name: 'Editar' })).toHaveCount(0);

    await compras.getByRole('button', { name: 'Histórico' }).click();
    await expect(compras.locator('table.tarefa-historico tbody tr td:nth-child(2)')).toHaveText([
      'Pedido criado',
      'Responsável: Ana Compras E2E',
      'Aberta → Em andamento',
      'Em andamento → Concluída',
    ]);
  } finally {
    await ana.app.close();
  }
});

test('o criador edita e cancela o próprio pedido no app', async () => {
  const { app, janela } = await abrirAppLogado(USUARIOS.pedeCompras);
  try {
    await abrirAba(janela, 'Compras');
    const compras = raiz(janela);
    await novoPedido(janela, 'fita', 'TPP0003 — Fita Adesiva Fictícia 48 mm', '3,5');

    await compras.getByRole('button', { name: 'Editar' }).click();
    await compras.getByLabel('Quantidade').fill('4');
    await compras.getByRole('button', { name: 'Salvar alterações' }).click();
    await expect(compras.locator('.artes-sucesso')).toHaveText('Pedido atualizado');
    await expect(compras.getByText('4', { exact: true })).toBeVisible();

    janela.once('dialog', (dialogo) => void dialogo.accept());
    await compras.getByRole('button', { name: 'Cancelar pedido' }).click();
    await expect(compras.locator('.artes-sucesso')).toHaveText('Pedido cancelado');
    await expect(compras.locator('.compra-status')).toHaveText('Cancelada');
    await expect(compras.getByRole('button', { name: 'Cancelar pedido' })).toHaveCount(0);

    await compras.getByRole('button', { name: 'Histórico' }).click();
    await expect(compras.locator('table.tarefa-historico tbody tr td:nth-child(2)')).toHaveText([
      'Pedido criado',
      'Quantidade: 3,5 → 4',
      'Aberta → Cancelada',
    ]);
  } finally {
    await app.close();
  }
});
