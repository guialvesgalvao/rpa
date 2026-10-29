import { describe, expect, it } from 'vitest';

import {
  validarCadastro,
  validarConsultaClientes,
  validarId,
  validarTipoArquivo,
} from '../../../src/app/validacao.js';

const ID = '3f0c6d2e-8a41-4b5e-9d3a-1c2b3d4e5f60';

describe('validarId', () => {
  it('aceita uuid e recusa o resto', () => {
    expect(validarId(ID)).toBe(ID);
    expect(() => validarId('../etc')).toThrow('Identificador inválido.');
    expect(() => validarId(undefined)).toThrow();
  });
});

describe('validarConsultaClientes', () => {
  it('apara a busca e descarta busca e cursor vazios', () => {
    expect(validarConsultaClientes({ busca: '  Gráfica  ', cursor: 'abc' })).toEqual({
      busca: 'Gráfica',
      cursor: 'abc',
    });
    expect(validarConsultaClientes({ busca: '   ', cursor: null })).toEqual({
      busca: undefined,
      cursor: undefined,
    });
  });

  it('recusa busca acima de 100 caracteres e formato inesperado', () => {
    expect(() => validarConsultaClientes({ busca: 'a'.repeat(101) })).toThrow('Busca inválida.');
    expect(() => validarConsultaClientes({ cursor: 'a'.repeat(513) })).toThrow();
    expect(() => validarConsultaClientes('x')).toThrow();
  });
});

describe('validarTipoArquivo', () => {
  it('aceita só pdf e imagem', () => {
    expect(validarTipoArquivo('pdf')).toBe('pdf');
    expect(validarTipoArquivo('imagem')).toBe('imagem');
    expect(() => validarTipoArquivo('exe')).toThrow('Tipo de arquivo inválido.');
  });
});

describe('validarCadastro', () => {
  const base = { clienteId: ID, produtoId: ID, nome: '', corId: ID, maquinaIds: [ID] };

  it('aceita o cadastro com arquivos opcionais', () => {
    expect(validarCadastro({ ...base, pdfId: ID })).toEqual({ ...base, pdfId: ID });
  });

  it('deixa passar ids de campo vazios (a regra de campo é de validarNovaArte)', () => {
    expect(validarCadastro({ ...base, produtoId: '', corId: '', maquinaIds: [] })).toBeTruthy();
  });

  it('recusa cliente fora de uuid, id de arquivo malformado e excesso de máquinas', () => {
    expect(() => validarCadastro({ ...base, clienteId: 'x' })).toThrow('Dados da arte inválidos.');
    expect(() => validarCadastro({ ...base, pdfId: 'C:\\arquivo.pdf' })).toThrow();
    expect(() => validarCadastro({ ...base, maquinaIds: Array(21).fill(ID) })).toThrow();
  });
});
