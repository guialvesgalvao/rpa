import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Page } from 'playwright';

import { ensureDir } from '../../utils/fs.js';
import type { ContextoDoc, SaidaDoc } from './documentos.js';
import {
  abrirNovaGuia,
  type AjustePdf,
  buscarPedido,
  clicarNoMenu,
  interceptarImpressao,
  pdfDaGuiaImpressa,
} from './guia.js';
import { caminhoLivre, nomeRecibo } from './nomes.js';

const MENU_ITEM = 'Imprimir';
const ORDEM = 'Inserção';
/** A guia do recibo é HTML (`relatorios/venda.impressao.php`), não PDF (achado da Task 2). */
const GUIA_RECIBO = 'venda.impressao.php';

/**
 * O recibo é um bloco de 700px de largura fixa, sem margem automática, e o PDF sai sem margens:
 * sem o ajuste, ele fica encostado à esquerda da folha A4. Centraliza só esse bloco.
 */
export const AJUSTE_RECIBO: AjustePdf = {
  css: '#slot_venda > div { margin-left: auto !important; margin-right: auto !important; }',
};

/**
 * Busca o pedido na listagem de vendas (já aberta), aciona "⋮ → Imprimir" com Ordem: Inserção e
 * salva como PDF a guia HTML que o Bling abre. Sem efeito fiscal.
 */
export async function gerarRecibo({
  page,
  numero,
  dados,
  destDir,
  rastro,
}: ContextoDoc): Promise<SaidaDoc> {
  const row = await rastro.etapa(`Busquei o pedido ${numero} na listagem`, () =>
    buscarPedido(page, numero),
  );
  await rastro.etapa(`Abri o menu ⋮ e cliquei em ${MENU_ITEM}`, () => clicarNoMenu(row, MENU_ITEM));
  const dialogo = page
    .locator('.ui-dialog')
    .filter({ hasText: 'Opções de impressão', visible: true });
  const semPrint = await interceptarImpressao(page);
  let guia: Page | undefined;
  try {
    await rastro.etapa(`Selecionei Ordem: ${ORDEM}`, async () => {
      const campo = dialogo.locator('#options_print_receipt');
      await campo.click();
      // A lista do dropdown é renderizada fora do diálogo.
      await page
        .locator('ul.Dropdown.Dropdown--fixed li.Dropdown-item')
        .filter({ visible: true })
        .getByText(ORDEM, { exact: true })
        .click();
      const escolhida = (await campo.locator('.InputDropdown-text').innerText()).trim();
      if (escolhida !== ORDEM) throw new Error(`Ordem ficou "${escolhida}" em vez de "${ORDEM}"`);
    });
    guia = await rastro.etapa('Confirmei a impressão', () =>
      abrirNovaGuia(page, () => dialogo.getByRole('button', { name: 'Ok', exact: true }).click()),
    );
    const aberta = guia;
    const pdf = await rastro.etapa('Gerei o PDF', () =>
      pdfDaGuiaImpressa(aberta, GUIA_RECIBO, 'recibo', AJUSTE_RECIBO),
    );
    const destino = await caminhoLivre(
      await ensureDir(destDir),
      nomeRecibo(dados.cliente, dados.parcelas),
    );
    // 'wx': nunca sobrescreve um arquivo existente.
    await rastro.etapa(`Salvei ${path.basename(destino)}`, () =>
      writeFile(destino, pdf, { flag: 'wx' }),
    );
    return { arquivos: [destino] };
  } finally {
    await semPrint.dispose().catch(() => undefined);
    await guia?.close().catch(() => undefined);
    await page.bringToFront();
    await page.keyboard.press('Escape');
  }
}
