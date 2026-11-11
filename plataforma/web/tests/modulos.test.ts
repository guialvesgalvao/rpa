import { describe, expect, it } from 'vitest';

import { inicioDaEmpresa, itensDoMenu, permissoesNaEmpresa } from '../src/modulos';

describe('itensDoMenu', () => {
  it('mostra só as abas dos módulos permitidos, na ordem do menu', () => {
    expect(itensDoMenu(['usuarios', 'artes'], 'aba').map((item) => item.segmento)).toEqual([
      'artes',
      'usuarios',
    ]);
    expect(itensDoMenu(['usuarios'], 'aba').map((item) => item.rotulo)).toEqual(['Usuários']);
  });

  it('Compras só aparece nas empresas com sincronização do Bling', () => {
    const permissoes = ['artes', 'compras', 'usuarios'];
    expect(itensDoMenu(permissoes, 'roma').map((item) => item.rotulo)).toEqual([
      'Artes',
      'Compras',
      'Usuários',
    ]);
    expect(itensDoMenu(permissoes, 'aba').map((item) => item.rotulo)).toEqual([
      'Artes',
      'Usuários',
    ]);
    expect(inicioDaEmpresa('roma', ['compras'])).toBe('/roma/compras');
    expect(inicioDaEmpresa('aba', ['compras'])).toBe('/aba');
  });

  it('sem permissões, ou só com subpermissão solta, não mostra nada', () => {
    expect(itensDoMenu([], 'roma')).toEqual([]);
    expect(itensDoMenu(undefined, 'roma')).toEqual([]);
    expect(itensDoMenu(['artes.adicionar', 'compras.pedir'], 'roma')).toEqual([]);
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
