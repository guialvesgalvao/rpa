import { describe, expect, it } from 'vitest';

import {
  abaAoRemontar,
  abaInicial,
  abasDaSessao,
  AUTOMACOES,
  ordenarMenu,
  podeConfigurarBling,
  podeSincronizarBling,
  podeUsarOp,
} from '../../src/app/menu.js';
import { PERMISSOES } from '../../src/app/plataforma/contratos.js';

// O que os perfis antigos viraram na migração: o administrador tem tudo; a arte finalista, Artes + adicionar.
const ADMIN = [...PERMISSOES];
const FINALISTA = ['artes', 'artes.adicionar'];

const rotulos = (itens: { rotulo: string }[]) => itens.map((item) => item.rotulo);

describe('menu de automações', () => {
  it('ordena Artes, Fatura e OP', () => {
    expect(rotulos(ordenarMenu(AUTOMACOES))).toEqual(['Artes', 'Fatura', 'OP', 'Usuários']);
  });

  it('ignora maiúsculas e acentos na ordem', () => {
    const itens = [{ rotulo: 'Ótica' }, { rotulo: 'artes' }, { rotulo: 'Banco' }];
    expect(rotulos(ordenarMenu(itens))).toEqual(['artes', 'Banco', 'Ótica']);
  });

  it('não altera o array original', () => {
    const itens = [{ rotulo: 'OP' }, { rotulo: 'Artes' }];
    ordenarMenu(itens);
    expect(rotulos(itens)).toEqual(['OP', 'Artes']);
  });

  it('abre na primeira aba em ordem alfabética', () => {
    expect(abaInicial(AUTOMACOES).id).toBe('artes');
  });

  it('não repete ids', () => {
    const ids = AUTOMACOES.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('admin da Roma vê todas as abas', () => {
    expect(abasDaSessao(ADMIN, 'roma').map((aba) => aba.id)).toEqual(
      AUTOMACOES.map((aba) => aba.id),
    );
  });

  it('admin de outra empresa, ou sem empresa, não vê a OP', () => {
    for (const empresa of ['aba', undefined, 'ROMA', ' roma']) {
      expect(abasDaSessao(ADMIN, empresa).map((aba) => aba.id)).toEqual([
        'fatura',
        'artes',
        'usuarios',
      ]);
    }
  });

  it.each(['aba', 'roma', undefined])('arte finalista (%s) vê só Artes e abre nela', (empresa) => {
    const abas = abasDaSessao(FINALISTA, empresa);
    expect(abas.map((aba) => aba.id)).toEqual(['artes']);
    expect(abaInicial(abas).id).toBe('artes');
  });

  it('OP só com a permissão e na Roma', () => {
    expect(podeUsarOp(['ops'], 'roma')).toBe(true);
    expect(podeUsarOp(ADMIN, 'roma')).toBe(true);
    expect(podeUsarOp(ADMIN, 'aba')).toBe(false);
    expect(podeUsarOp(ADMIN, undefined)).toBe(false);
    expect(podeUsarOp(FINALISTA, 'roma')).toBe(false);
    expect(podeUsarOp(FINALISTA, 'aba')).toBe(false);
  });

  it('cada aba exige a permissão do módulo dela', () => {
    expect(abasDaSessao(['faturas'], 'roma').map((aba) => aba.id)).toEqual(['fatura']);
    expect(abasDaSessao(['ops'], 'roma').map((aba) => aba.id)).toEqual(['op']);
    expect(abasDaSessao(['ops'], 'aba')).toEqual([]);
    expect(abasDaSessao(['usuarios', 'artes'], 'aba').map((aba) => aba.id)).toEqual([
      'artes',
      'usuarios',
    ]);
  });

  it('sem permissão, ou só com subpermissão solta, não há abas nem aba para abrir', () => {
    for (const permissoes of [[], undefined, ['artes.adicionar'], ['compras']]) {
      expect(abasDaSessao(permissoes, 'roma')).toEqual([]);
    }
    expect(abaAoRemontar([], 'artes')).toBeUndefined();
  });

  it('credenciais do Bling: quem gera Faturas ou OPs', () => {
    expect(podeConfigurarBling(['faturas'])).toBe(true);
    expect(podeConfigurarBling(['ops'])).toBe(true);
    expect(podeConfigurarBling(FINALISTA)).toBe(false);
    expect(podeConfigurarBling(undefined)).toBe(false);
  });

  it('não altera AUTOMACOES ao montar as abas do perfil', () => {
    abasDaSessao(ADMIN, 'roma').pop();
    expect(AUTOMACOES).toHaveLength(4);
  });

  it('ao remontar, fica na aba atual se ela continua liberada', () => {
    const daRoma = abasDaSessao(ADMIN, 'roma');
    const daAba = abasDaSessao(ADMIN, 'aba');
    expect(abaAoRemontar(daAba, 'fatura')?.id).toBe('fatura');
    expect(abaAoRemontar(daRoma, 'op')?.id).toBe('op');
  });

  it('ao remontar sem a aba atual (OP fora da Roma) ou sem aba, abre na primeira', () => {
    expect(abaAoRemontar(abasDaSessao(ADMIN, 'aba'), 'op')?.id).toBe('artes');
    expect(abaAoRemontar(abasDaSessao(ADMIN, 'roma'), undefined)?.id).toBe('artes');
  });
});

describe('podeSincronizarBling', () => {
  it('só quem tem OP na Roma vê a sincronização com o Bling', () => {
    expect(podeSincronizarBling(['ops'], 'roma')).toBe(true);
    expect(podeSincronizarBling(ADMIN, 'roma')).toBe(true);
    expect(podeSincronizarBling(FINALISTA, 'roma')).toBe(false);
    expect(podeSincronizarBling(ADMIN, 'aba')).toBe(false);
    expect(podeSincronizarBling(ADMIN, 'ROMA')).toBe(false);
    expect(podeSincronizarBling(ADMIN, undefined)).toBe(false);
  });
});
