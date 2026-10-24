import path from 'node:path';

import { withBrowser } from '../../core/browser.js';
import { defineProcess } from '../../core/process.js';
import { saveDownload } from '../../utils/download.js';
import { ensureDir, timestampedName } from '../../utils/fs.js';
import { splitPdf } from '../../utils/pdf.js';

/**
 * Processo de demonstração:
 * 1. acessa um site público e coleta título/texto;
 * 2. gera um relatório PDF de 3 páginas e salva no diretório de saída;
 * 3. baixa um arquivo pelo fluxo de download do navegador;
 * 4. divide o PDF em um arquivo por página.
 */
export default defineProcess({
  name: 'exemplo',
  description: 'Demonstra navegação, download, geração e divisão de PDF',
  async run({ config, logger }) {
    const outputDir = await ensureDir(config.outputDir);

    const reportFile = await withBrowser(config, logger, async ({ page }) => {
      await page.goto('https://example.com');
      const title = await page.title();
      const text = await page.locator('p').first().innerText();
      logger.info({ title }, 'Página acessada');

      const sections = [title, text, `Gerado em ${new Date().toLocaleString('pt-BR')}`];
      const link = `<a id="baixar" download="dados.csv" href="data:text/csv,coluna%3Bvalor%0Atitulo%3B${encodeURIComponent(title)}">Baixar</a>`;
      const html = sections
        .map((s, i) => {
          const style = i > 0 ? ' style="break-before: page"' : '';
          return `<section${style}><h1>Seção ${i + 1}</h1><p>${s}</p></section>`;
        })
        .join('');
      await page.setContent(link + html);

      const csv = await saveDownload(
        page,
        () => page.locator('#baixar').click(),
        config.downloadDir,
      );
      logger.info({ csv }, 'Arquivo baixado');

      // page.pdf() só funciona com Chromium em modo headless.
      const file = path.join(outputDir, timestampedName('relatorio', '.pdf'));
      await page.pdf({ path: file, format: 'A4' });
      return file;
    });
    logger.info({ reportFile }, 'Relatório PDF salvo');

    const splitDir = path.join(outputDir, path.basename(reportFile, '.pdf'));
    const parts = await splitPdf(reportFile, splitDir);
    logger.info({ parts: parts.length, splitDir }, 'PDF dividido por página');
  },
});
