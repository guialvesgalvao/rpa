import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  countPages,
  mergePdfs,
  separarPaginas,
  splitPdf,
  splitPdfByRanges,
} from '../../src/utils/pdf.js';

let dir: string;
let source: string;

async function createPdf(file: string, pages: number): Promise<void> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) doc.addPage();
  await writeFile(file, await doc.save());
}

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'rpa-pdf-'));
  source = path.join(dir, 'origem.pdf');
  await createPdf(source, 4);
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('pdf utils', () => {
  it('divide em um arquivo por página', async () => {
    const parts = await splitPdf(source, path.join(dir, 'out'));
    expect(parts.map((p) => path.basename(p))).toEqual([
      'origem_p1.pdf',
      'origem_p2.pdf',
      'origem_p3.pdf',
      'origem_p4.pdf',
    ]);
    for (const part of parts) expect(await countPages(part)).toBe(1);
  });

  it('divide por intervalos', async () => {
    const [a, b] = await splitPdfByRanges(
      source,
      [
        [1, 3],
        [4, 4],
      ],
      path.join(dir, 'out'),
    );
    expect(await countPages(a!)).toBe(3);
    expect(await countPages(b!)).toBe(1);
  });

  it('rejeita intervalo inválido', async () => {
    await expect(splitPdfByRanges(source, [[3, 5]], dir)).rejects.toThrow('Intervalo inválido');
  });

  it('junta PDFs', async () => {
    const other = path.join(dir, 'outro.pdf');
    await createPdf(other, 2);
    const merged = await mergePdfs([source, other], path.join(dir, 'junto.pdf'));
    expect(await countPages(merged)).toBe(6);
  });

  it('separa em memória, um PDF de 1 página por página, na ordem', async () => {
    const doc = await PDFDocument.create();
    for (const largura of [100, 200, 300]) doc.addPage([largura, 500]);
    const partes = await separarPaginas(await doc.save());
    expect(partes).toHaveLength(3);
    const larguras = [];
    for (const parte of partes) {
      const pdf = await PDFDocument.load(parte);
      expect(pdf.getPageCount()).toBe(1);
      larguras.push(pdf.getPage(0).getWidth());
    }
    expect(larguras).toEqual([100, 200, 300]);
  });

  it('separa um PDF lido do disco', async () => {
    expect(await separarPaginas(await readFile(source))).toHaveLength(4);
  });
});
