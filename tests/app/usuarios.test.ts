import { describe, expect, it } from 'vitest';

import { descreverUsuario, empresasDoFormulario } from '../../src/app/usuarios/dados.js';

// Dados sintéticos.
const aba = { slug: 'aba', nome: 'ABA Embalagens' };
const roma = { slug: 'roma', nome: 'Roma Embalagens' };

describe('empresasDoFormulario', () => {
  it('uma empresa: fixa e marcada', () => {
    expect(empresasDoFormulario([roma])).toEqual({
      opcoes: [roma],
      fixa: true,
      marcadas: ['roma'],
    });
  });

  it('várias: em ordem de nome, nenhuma marcada', () => {
    expect(empresasDoFormulario([roma, aba])).toEqual({
      opcoes: [aba, roma],
      fixa: false,
      marcadas: [],
    });
  });
});

describe('descreverUsuario', () => {
  it('perfil, empresas pelo nome (slug se desconhecida) e inativo', () => {
    expect(
      descreverUsuario({ perfil: 'arte_finalista', empresas: ['aba', 'xyz'], ativo: true }, [aba]),
    ).toBe('Arte finalista · ABA Embalagens, xyz');
    expect(descreverUsuario({ perfil: 'admin', empresas: ['roma'], ativo: false }, [roma])).toBe(
      'Administrador · Roma Embalagens · inativo',
    );
  });
});
