import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { expect, type Page, test } from '@playwright/test';

import { resumirPdf } from '../../tests/helpers/pdf-layout.js';
import { USUARIOS } from '../apoio/ambiente.js';
import { abrirAba, abrirAppLogado, fecharConfiguracoesSeAbrir } from '../apoio/app.js';
import { pastaTemporaria } from '../apoio/arquivos.js';

// OP com a fixture sintética (RPA_OP_MOCK=1, tests/fixtures/pedido-op.json): nada vai ao Bling. A geração
// reserva números de OP só no banco `rpa_e2e`.

const OBSERVACAO = 'Entregar com caixa reforçada (texto fictício).';

async function irParaOpDaRoma(janela: Page): Promise<void> {
  await janela.locator('#empresa').click();
  await janela.locator('dialog#empresas').getByRole('button', { name: /Roma/ }).click();
  await fecharConfiguracoesSeAbrir(janela);
  await abrirAba(janela, 'OP');
}

async function buscarPedido(janela: Page, numero: string): Promise<void> {
  await janela.locator('#op-numeros').fill(numero);
  await janela.locator('#op-confirmar').click();
  await expect(janela.locator('#op-pedidos .op-item', { hasText: 'XX0001' })).toBeVisible({
    timeout: 20_000,
  });
}

const itemXX0001 = (janela: Page) => janela.locator('#op-pedidos .op-item', { hasText: 'XX0001' });

test('observação do pedido: pré-preenche, sai no PDF e, apagada, não volta ao buscar de novo', async () => {
  test.setTimeout(180_000);
  const { app, janela } = await abrirAppLogado(USUARIOS.admin);
  try {
    await irParaOpDaRoma(janela);
    await buscarPedido(janela, '101');

    // A observação da fixture entra como Observação da OP.
    await itemXX0001(janela)
      .getByRole('button', { name: /Editar dados da OP|Pré-preencher OP/ })
      .click();
    const observacao = janela.locator('#op-detalhe').getByLabel('Observação');
    await expect(observacao).toHaveValue(OBSERVACAO);
    await janela.locator('#op-detalhe').getByRole('button', { name: 'Cancelar' }).click();

    // Gera a OP numa pasta temporária e confere o texto do PDF.
    const pasta = pastaTemporaria('op');
    await janela.locator('#op-pasta').fill(pasta);
    await expect(janela.locator('#op-gerar')).toBeEnabled();
    await janela.locator('#op-gerar').click();
    await janela.locator('#op-confirmacao-gerar').click();
    await expect(janela.locator('#op-resumo')).toHaveText(/1 de 1 OP\(s\) gerada\(s\)/, {
      timeout: 120_000,
    });
    const pdfs = readdirSync(pasta).filter((nome) => nome.toLowerCase().endsWith('.pdf'));
    expect(pdfs.length).toBeGreaterThan(0);
    const resumo = await resumirPdf(readFileSync(path.join(pasta, pdfs[0]!)));
    expect(resumo.texto.replace(/\s+/g, ' ')).toContain('Entregar com caixa reforçada');

    // Apagar a observação, salvar e buscar o pedido de novo: ela não volta.
    await itemXX0001(janela)
      .getByRole('button', { name: /Editar dados da OP|Pré-preencher OP/ })
      .click();
    await observacao.fill('');
    await janela.locator('#op-detalhe').getByRole('button', { name: 'Salvar' }).click();
    await expect(
      itemXX0001(janela).getByRole('button', { name: 'Pré-preencher OP' }),
    ).toBeVisible();
    await buscarPedido(janela, '101');
    await itemXX0001(janela).getByRole('button', { name: 'Pré-preencher OP' }).click();
    await expect(observacao).toHaveValue('');
  } finally {
    await app.close();
  }
});
