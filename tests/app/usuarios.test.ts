import { describe, expect, it } from 'vitest';

import {
  descreverUsuario,
  empresasCom,
  empresasDoFormulario,
  podeEditarDados,
} from '../../src/app/usuarios/dados.js';

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
  it('área, empresas pelo nome (slug se desconhecida) e inativo', () => {
    const empresas = [
      { slug: 'aba', permissoes: [] },
      { slug: 'xyz', permissoes: [] },
    ];
    expect(descreverUsuario({ area: 'producao', empresas, ativo: true }, [aba])).toBe(
      'Produção · ABA Embalagens, xyz',
    );
    expect(
      descreverUsuario({ area: null, empresas: [{ slug: 'roma', permissoes: [] }], ativo: false }, [
        roma,
      ]),
    ).toBe('Sem área · Roma Embalagens · inativo');
  });
});

describe('empresasCom e podeEditarDados', () => {
  const minhas = [
    { ...aba, permissoes: ['usuarios', 'usuarios.editar', 'usuarios.permissoes'] },
    { ...roma, permissoes: ['usuarios', 'usuarios.permissoes'] },
  ];

  it('empresas em que tenho a permissão', () => {
    expect(empresasCom(minhas, 'usuarios.editar').map((e) => e.slug)).toEqual(['aba']);
    expect(empresasCom(minhas, 'usuarios.permissoes').map((e) => e.slug)).toEqual(['aba', 'roma']);
    expect(empresasCom(minhas, 'artes')).toEqual([]);
  });

  it('só edita os dados de quem está apenas em empresas em que posso editar usuários', () => {
    const naAba = { empresas: [{ slug: 'aba', permissoes: [] }] };
    const nasDuas = {
      empresas: [
        { slug: 'aba', permissoes: [] },
        { slug: 'roma', permissoes: [] },
      ],
    };
    expect(podeEditarDados(naAba, minhas)).toBe(true);
    expect(podeEditarDados(nasDuas, minhas)).toBe(false);
  });
});
