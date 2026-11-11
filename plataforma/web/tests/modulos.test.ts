import { describe, expect, it } from 'vitest';

import { inicioDaEmpresa, itensDoMenu, permissoesNaEmpresa } from '../src/modulos';

describe('itensDoMenu', () => {
  it('mostra só as abas dos módulos permitidos, na ordem do menu', () => {
    expect(itensDoMenu(['usuarios', 'artes']).map((item) => item.segmento)).toEqual([
      'artes',
      'usuarios',
    ]);
    expect(itensDoMenu(['usuarios']).map((item) => item.rotulo)).toEqual(['Usuários']);
  });

  it('sem permissões, ou só com subpermissão solta, não mostra nada', () => {
    expect(itensDoMenu([])).toEqual([]);
    expect(itensDoMenu(undefined)).toEqual([]);
    expect(itensDoMenu(['artes.adicionar', 'compras'])).toEqual([]);
  });
});

describe('inicioDaEmpresa', () => {
  it('abre a primeira aba permitida', () => {
    expect(inicioDaEmpresa('aba', ['artes', 'usuarios'])).toBe('/aba/artes');
    expect(inicioDaEmpresa('roma', ['usuarios'])).toBe('/roma/usuarios');
  });

  it('sem nenhuma aba, fica na raiz da empresa (aviso de sem acesso)', () => {
    expect(inicioDaEmpresa('aba', [])).toBe('/aba');
    expect(inicioDaEmpresa('aba', ['faturas'])).toBe('/aba');
  });
});

describe('permissoesNaEmpresa', () => {
  const eu = {
    empresas: [
      { slug: 'aba', nome: 'ABA', permissoes: ['artes'] },
      { slug: 'roma', nome: 'Roma', permissoes: ['usuarios'] },
    ],
  };

  it('devolve as da empresa pedida; vazio para empresa alheia', () => {
    expect(permissoesNaEmpresa(eu, 'roma')).toEqual(['usuarios']);
    expect(permissoesNaEmpresa(eu, 'outra')).toEqual([]);
  });
});
