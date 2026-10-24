import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { PDFDocument } from 'pdf-lib';

import { ensureDir } from './fs.js';

/** Intervalo de páginas, 1-based e inclusivo. Ex.: [1, 3] = páginas 1, 2 e 3. */
export type PageRange = [start: number, end: number];

async function loadPdf(file: string): Promise<PDFDocument> {
  return PDFDocument.load(await readFile(file));
}

export async function countPages(file: string): Promise<number> {
  return (await loadPdf(file)).getPageCount();
}

/** Gera um PDF por intervalo. Retorna os caminhos criados. */
export async function splitPdfByRanges(
  file: string,
  ranges: PageRange[],
  outDir: string,
): Promise<string[]> {
  const source = await loadPdf(file);
  const total = source.getPageCount();
  const base = path.basename(file, path.extname(file));
  await ensureDir(outDir);

  const created: string[] = [];
  for (const [start, end] of ranges) {
    if (start < 1 || end > total || start > end) {
      throw new Error(`Intervalo inválido [${start}, ${end}] para PDF com ${total} páginas`);
    }
    const target = await PDFDocument.create();
    const indices = Array.from({ length: end - start + 1 }, (_, i) => start - 1 + i);
    const pages = await target.copyPages(source, indices);
    pages.forEach((page) => target.addPage(page));

    const suffix = start === end ? `p${start}` : `p${start}-${end}`;
    const outFile = path.join(outDir, `${base}_${suffix}.pdf`);
    await writeFile(outFile, await target.save());
    created.push(outFile);
  }
  return created;
}

/** Gera um PDF para cada página. */
export async function splitPdf(file: string, outDir: string): Promise<string[]> {
  const total = await countPages(file);
  const ranges = Array.from({ length: total }, (_, i): PageRange => [i + 1, i + 1]);
  return splitPdfByRanges(file, ranges, outDir);
}

/** Separa um PDF em memória: um PDF de 1 página para cada página, na ordem original. */
export async function separarPaginas(bytes: Uint8Array): Promise<Uint8Array[]> {
  const source = await PDFDocument.load(bytes);
  const partes: Uint8Array[] = [];
  for (const index of source.getPageIndices()) {
    const target = await PDFDocument.create();
    const [page] = await target.copyPages(source, [index]);
    target.addPage(page!);
    partes.push(await target.save());
  }
  return partes;
}

/** Junta vários PDFs, na ordem informada, em um único arquivo. */
export async function mergePdfs(files: string[], outFile: string): Promise<string> {
  const target = await PDFDocument.create();
  for (const file of files) {
    const source = await loadPdf(file);
    const pages = await target.copyPages(source, source.getPageIndices());
    pages.forEach((page) => target.addPage(page));
  }
  await ensureDir(path.dirname(outFile));
  await writeFile(outFile, await target.save());
  return outFile;
}
