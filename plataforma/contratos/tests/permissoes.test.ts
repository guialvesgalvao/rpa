import { describe, expect, it } from 'vitest';

import {
  EsquemaCriacaoUsuario,
  EsquemaEdicaoUsuario,
  EsquemaEu,
  MODULOS,
  alternarPermissao,
  modulosDaEmpresa,
  PERMISSOES,
  PERMISSOES_DO_PERFIL,
  modulosPermitidos,
  normalizarPermissoes,
  perfilLegado,
  rotuloArea,
  temPermissao,
} from '../src/index.ts';

describe('catálogo de permissões', () => {
  it('a lista plana é a árvore dos módulos, na mesma ordem', () => {
    const daArvore = MODULOS.flatMap((modulo) => [
      modulo.chave,
      ...modulo.subpermissoes.map((sub) => sub.chave),
    ]);
    expect(daArvore).toEqual([...PERMISSOES]);
  });

  it('toda subpermissão começa com a chave do módulo', () => {
    for (const modulo of MODULOS) {
      for (const sub of modulo.subpermissoes) {
        expect(sub.chave.startsWith(`${modulo.chave}.`)).toBe(true);
      }
    }
  });
});

describe('temPermissao', () => {
  it('aceita o módulo e a subpermissão marcados', () => {
    expect(temPermissao(['artes', 'artes.adicionar'], 'artes')).toBe(true);
    expect(temPermissao(['artes', 'artes.adicionar'], 'artes.adicionar')).toBe(true);
  });

  it('recusa a subpermissão sem o módulo, a ausente e a lista vazia ou indefinida', () => {
    expect(temPermissao(['artes.adicionar'], 'artes.adicionar')).toBe(false);
    expect(temPermissao(['artes'], 'artes.editar')).toBe(false);
    expect(temPermissao([], 'artes')).toBe(false);
    expect(temPermissao(undefined, 'artes')).toBe(false);
  });
});

describe('normalizarPermissoes', () => {
  it('tira desconhecidas, repetidas e subpermissões órfãs, na ordem do catálogo', () => {
    expect(
      normalizarPermissoes(['ops', 'artes.editar', 'compras.pedir', 'artes', 'ops', 'inventada']),
    ).toEqual(['artes', 'artes.editar', 'ops']);
  });
});

describe('perfilLegado', () => {
  it('só Artes (ou nada) vira arte_finalista', () => {
    expect(perfilLegado([{ permissoes: ['artes', 'artes.adicionar'] }])).toBe('arte_finalista');
    expect(perfilLegado([{ permissoes: [] }])).toBe('arte_finalista');
    expect(perfilLegado([])).toBe('arte_finalista');
  });

  it('qualquer módulo fora de Artes, em qualquer empresa, vira admin', () => {
    expect(perfilLegado([{ permissoes: ['artes'] }, { permissoes: ['compras'] }])).toBe('admin');
    expect(perfilLegado([{ permissoes: [...PERMISSOES_DO_PERFIL.admin] }])).toBe('admin');
  });

  it('subpermissão órfã não conta', () => {
    expect(perfilLegado([{ permissoes: ['usuarios.editar'] }])).toBe('arte_finalista');
  });
});

describe('modulosPermitidos', () => {
  it('devolve os módulos marcados, na ordem do painel', () => {
    expect(modulosPermitidos(['usuarios', 'artes']).map((modulo) => modulo.chave)).toEqual([
      'artes',
      'usuarios',
    ]);
    expect(modulosPermitidos(undefined)).toEqual([]);
  });
});

describe('rotuloArea', () => {
  it('mostra o rótulo ou "Sem área"', () => {
    expect(rotuloArea('producao')).toBe('Produção');
    expect(rotuloArea(null)).toBe('Sem área');
  });
});

describe('contratos com permissões', () => {
  const euAntigo = {
    id: '7b0e6c0a-3f5e-4c59-9d0a-2f3c1a4b5d6e',
    nome: 'Pessoa Teste',
    email: 'pessoa@exemplo.com',
    perfil: 'admin',
    empresas: [{ slug: 'aba', nome: 'ABA' }],
  };

  it('resposta antiga de /v1/eu (sem permissões nem área) continua válida', () => {
    const eu = EsquemaEu.parse(euAntigo);
    expect(eu.empresas[0]?.permissoes).toEqual([]);
    expect(eu.area).toBeNull();
    expect(eu.deveTrocarSenha).toBe(false);
  });

  it('permissão e área desconhecidas não derrubam a sessão', () => {
    const eu = EsquemaEu.parse({
      ...euAntigo,
      area: 'area_futura',
      empresas: [{ slug: 'aba', nome: 'ABA', permissoes: ['artes', 'modulo_futuro'] }],
    });
    expect(eu.area).toBeNull();
    expect(temPermissao(eu.empresas[0]?.permissoes, 'artes')).toBe(true);
  });

  it('criação: área e permissões são opcionais', () => {
    const novo = EsquemaCriacaoUsuario.parse({
      nome: ' Pessoa ',
      email: 'Pessoa@Exemplo.com',
      empresas: ['ABA'],
      senha: 'senha-de-teste-1',
    });
    expect(novo).toMatchObject({
      nome: 'Pessoa',
      email: 'pessoa@exemplo.com',
      area: null,
      empresas: ['aba'],
      permissoes: {},
    });
  });

  it('criação recusa permissão fora do catálogo', () => {
    const resultado = EsquemaCriacaoUsuario.safeParse({
      nome: 'Pessoa',
      email: 'pessoa@exemplo.com',
      empresas: ['aba'],
      senha: 'senha-de-teste-1',
      permissoes: { aba: ['inventada'] },
    });
    expect(resultado.success).toBe(false);
  });

  it('edição exige ao menos um campo', () => {
    expect(EsquemaEdicaoUsuario.safeParse({}).success).toBe(false);
    expect(EsquemaEdicaoUsuario.parse({ area: null })).toEqual({ area: null });
  });
});

describe('modulosDaEmpresa', () => {
  it('Compras só aparece na empresa com sincronização do Bling', () => {
    expect(modulosDaEmpresa('roma').map((modulo) => modulo.chave)).toContain('compras');
    expect(modulosDaEmpresa('aba').map((modulo) => modulo.chave)).toEqual([
      'artes',
      'faturas',
      'ops',
      'usuarios',
    ]);
  });
});

describe('alternarPermissao', () => {
  it('marca o módulo e a subpermissão; a subpermissão sem o módulo não entra', () => {
    expect(alternarPermissao([], 'artes', true)).toEqual(['artes']);
    expect(alternarPermissao(['artes'], 'artes.editar', true)).toEqual(['artes', 'artes.editar']);
    expect(alternarPermissao([], 'artes.editar', true)).toEqual([]);
  });

  it('desmarcar o módulo leva as subpermissões dele; desmarcar uma subpermissão, só ela', () => {
    const marcadas = ['artes', 'artes.adicionar', 'artes.editar', 'ops'];
    expect(alternarPermissao(marcadas, 'artes', false)).toEqual(['ops']);
    expect(alternarPermissao(marcadas, 'artes.editar', false)).toEqual([
      'artes',
      'artes.adicionar',
      'ops',
    ]);
  });
});
