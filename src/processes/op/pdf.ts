import { writeFile } from 'node:fs/promises';
import type { Page } from 'playwright';

import { ensureDir, safeFileName } from '../../utils/fs.js';
import { salvarComoPdf } from '../bling/guia.js';
import { caminhoLivre } from '../bling/nomes.js';
import { htmlDaOp } from './template.js';
import type { OrdemProducao } from './tipos.js';

/** Ex.: "OP 12 Pizzaria Ficticia RA0012.pdf". */
export function nomeOp(op: OrdemProducao): string {
  const cliente = op.cliente.fantasia?.trim() || op.cliente.nome;
  return `${safeFileName(`OP ${op.numero} ${cliente} ${op.item.codigo}`)}.pdf`;
}

/** Renderiza a OP em `page` (uma guia em branco do Chromium) e devolve o PDF A4. */
export async function gerarPdfOp(page: Page, op: OrdemProducao): Promise<Buffer> {
  // 'load' espera as imagens embutidas (logo e arte) antes de gerar o PDF.
  await page.setContent(htmlDaOp(op), { waitUntil: 'load' });
  return salvarComoPdf(page, 'arquivo da OP');
}

/** Gera o PDF da OP e o grava em `destDir` sem sobrescrever nada; devolve o caminho. */
export async function salvarPdfOp(page: Page, op: OrdemProducao, destDir: string): Promise<string> {
  const pdf = await gerarPdfOp(page, op);
  const destino = await caminhoLivre(await ensureDir(destDir), nomeOp(op));
  // 'wx': nunca sobrescreve um arquivo existente.
  await writeFile(destino, pdf, { flag: 'wx' });
  return destino;
}
