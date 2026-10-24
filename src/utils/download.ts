import path from 'node:path';
import type { Page } from 'playwright';

import { ensureDir, safeFileName } from './fs.js';

/**
 * Executa a ação que dispara o download e salva o arquivo em destDir.
 * Ex.: await saveDownload(page, () => page.getByRole('link', { name: 'Baixar' }).click(), dir)
 */
export async function saveDownload(
  page: Page,
  trigger: () => Promise<unknown>,
  destDir: string,
  fileName?: string,
): Promise<string> {
  await ensureDir(destDir);
  const [download] = await Promise.all([page.waitForEvent('download'), trigger()]);
  const target = path.join(destDir, safeFileName(fileName ?? download.suggestedFilename()));
  await download.saveAs(target);
  return target;
}
