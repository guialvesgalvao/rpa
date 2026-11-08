import { describe, expect, it } from 'vitest';

import { formatarTamanho, problemaDosAnexos } from '../src/anexos';

const MB = 1024 * 1024;
const pdf = (size: number, name = 'a.pdf') => ({ name, type: 'application/pdf', size });
const png = (size: number, name = 'a.png') => ({ name, type: 'image/png', size });

describe('problemaDosAnexos', () => {
  it('texto ou anexo: os dois vazios é problema', () => {
    expect(problemaDosAnexos('  ', [])).toBe('Escreva o comentário ou anexe um arquivo.');
    expect(problemaDosAnexos('ok', [])).toBeUndefined();
    expect(problemaDosAnexos('', [pdf(10)])).toBeUndefined();
  });

  it('no máximo 5 anexos', () => {
    expect(
      problemaDosAnexos(
        '',
        Array.from({ length: 5 }, () => pdf(10)),
      ),
    ).toBeUndefined();
    expect(
      problemaDosAnexos(
        '',
        Array.from({ length: 6 }, () => pdf(10)),
      ),
    ).toMatch(/máximo 5/);
  });

  it('limite por tipo: PDF 25 MB, imagem 10 MB', () => {
    expect(problemaDosAnexos('', [pdf(25 * MB)])).toBeUndefined();
    expect(problemaDosAnexos('', [pdf(25 * MB + 1, 'grande.pdf')])).toBe(
      'grande.pdf passa de 25 MB.',
    );
    expect(problemaDosAnexos('', [png(10 * MB + 1, 'foto.png')])).toBe('foto.png passa de 10 MB.');
  });
});

describe('formatarTamanho', () => {
  it('B, KB e MB', () => {
    expect(formatarTamanho(820)).toBe('820 B');
    expect(formatarTamanho(12 * 1024)).toBe('12 KB');
    expect(formatarTamanho(3.4 * MB)).toBe('3,4 MB');
  });
});
