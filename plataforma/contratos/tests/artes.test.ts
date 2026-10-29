import { describe, expect, it } from 'vitest';

import { detectarTipo, LIMITES, nomeOuPadrao, rotuloArtes, validarNovaArte } from '../src/artes.ts';

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]);
const PDF = new TextEncoder().encode('%PDF-1.4\n');
const WEBP = new TextEncoder().encode('RIFF\0\0\0\0WEBPVP8 ');
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]);

describe('detectarTipo', () => {
  it('reconhece PDF, PNG, JPEG e WebP pelos primeiros bytes', () => {
    expect(detectarTipo(PDF)).toEqual({ tipo: 'pdf', mime: 'application/pdf' });
    expect(detectarTipo(PNG)).toEqual({ tipo: 'imagem', mime: 'image/png' });
    expect(detectarTipo(JPEG)).toEqual({ tipo: 'imagem', mime: 'image/jpeg' });
    expect(detectarTipo(WEBP)).toEqual({ tipo: 'imagem', mime: 'image/webp' });
  });

  it('devolve null para outros conteúdos', () => {
    expect(detectarTipo(new TextEncoder().encode('texto qualquer'))).toBeNull();
    expect(detectarTipo(new Uint8Array())).toBeNull();
    expect(detectarTipo(new TextEncoder().encode('RIFF\0\0\0\0WAVE'))).toBeNull();
  });
});

describe('nomeOuPadrao e rotuloArtes', () => {
  it('troca nome vazio por "Padrão"', () => {
    expect(nomeOuPadrao('')).toBe('Padrão');
    expect(nomeOuPadrao('   ')).toBe('Padrão');
    expect(nomeOuPadrao(undefined)).toBe('Padrão');
    expect(nomeOuPadrao(' Frente ')).toBe('Frente');
  });

  it('usa singular e plural', () => {
    expect(rotuloArtes(1)).toBe('1 arte');
    expect(rotuloArtes(3)).toBe('3 artes');
  });
});

describe('validarNovaArte', () => {
  const valida = {
    produtoId: 'p',
    corId: 'c',
    maquinaIds: ['m'],
    pdf: { tamanho: 10, tipo: 'pdf' as const },
  };

  it('aceita entrada completa', () => {
    expect(validarNovaArte(valida)).toEqual({});
  });

  it('pede produto, cor, máquina e ao menos um arquivo', () => {
    expect(validarNovaArte({ produtoId: '', corId: '', maquinaIds: [] })).toEqual({
      produtoId: 'Selecione um produto.',
      corId: 'Selecione uma cor.',
      maquinaIds: 'Selecione ao menos uma máquina.',
      arquivos: 'Envie ao menos um arquivo.',
    });
  });

  it('confere o limite de cada tipo de arquivo', () => {
    const pdfNoLimite = { ...valida, pdf: { tamanho: LIMITES.pdfBytes, tipo: 'pdf' as const } };
    expect(validarNovaArte(pdfNoLimite)).toEqual({});
    expect(
      validarNovaArte({ ...valida, pdf: { tamanho: LIMITES.pdfBytes + 1, tipo: 'pdf' } }).arquivos,
    ).toMatch(/25 MB/);
    expect(
      validarNovaArte({
        ...valida,
        pdf: null,
        imagem: { tamanho: LIMITES.imagemBytes + 1, tipo: 'imagem' },
      }).arquivos,
    ).toMatch(/10 MB/);
  });

  it('recusa tipo errado no campo', () => {
    expect(validarNovaArte({ ...valida, pdf: { tamanho: 1, tipo: null } }).arquivos).toBeDefined();
    expect(
      validarNovaArte({ ...valida, imagem: { tamanho: 1, tipo: 'pdf' } }).arquivos,
    ).toBeDefined();
  });
});
