import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// Arquivos sintéticos para o cadastro de arte (mesmos bytes mínimos do seed da plataforma).

export const PDF_MINIMO = Buffer.from(
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
    '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 72 72]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n',
  'latin1',
);

export const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==',
  'base64',
);

const MB = 1024 * 1024;

/** PDF válido no cabeçalho, completado com espaços até `megas` MB. */
export function pdfDeTamanho(megas: number): Buffer {
  const pdf = Buffer.alloc(Math.round(megas * MB), 0x20);
  PDF_MINIMO.copy(pdf);
  return pdf;
}

export function pastaTemporaria(prefixo: string): string {
  return mkdtempSync(path.join(tmpdir(), `rpa-e2e-${prefixo}-`));
}

/** Grava o conteúdo numa pasta temporária e devolve o caminho. */
export function arquivoTemporario(nome: string, conteudo: Buffer): string {
  const caminho = path.join(pastaTemporaria('arquivo'), nome);
  writeFileSync(caminho, conteudo);
  return caminho;
}
