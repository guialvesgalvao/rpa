import { describe, expect, it } from 'vitest';

import {
  caminhoPermitido,
  cookieEmpresa,
  cookiesApagados,
  destinoSeguro,
  empresaInicial,
  montarCookies,
  origemPermitida,
  precisaRenovar,
} from '../src/servidor/sessao';
import { tokenAcesso, tokensFicticios } from './apoio/api-falsa';

const agora = new Date('2026-10-29T12:00:00Z');

describe('precisaRenovar', () => {
  it('não renova um acesso com folga', () => {
    expect(precisaRenovar(tokenAcesso(agora.getTime() + 5 * 60 * 1000), agora)).toBe(false);
  });

  it('renova o acesso vencido ou a menos de 30 s do fim', () => {
    expect(precisaRenovar(tokenAcesso(agora.getTime() - 1000), agora)).toBe(true);
    expect(precisaRenovar(tokenAcesso(agora.getTime() + 20_000), agora)).toBe(true);
  });

  it('renova sem acesso, com token malformado ou sem exp', () => {
    expect(precisaRenovar(undefined, agora)).toBe(true);
    expect(precisaRenovar('nao-e-jwt', agora)).toBe(true);
    expect(precisaRenovar('eyJhbGciOiJub25lIn0.e30.', agora)).toBe(true);
  });
});

describe('montarCookies e cookiesApagados', () => {
  it('grava acesso (15 min) e renovação (30 dias) httpOnly, Lax e no caminho raiz', () => {
    const tokens = tokensFicticios();
    const [acesso, renovacao] = montarCookies(tokens, true);

    expect(acesso).toEqual({
      name: 'rpa_acesso',
      value: tokens.acesso,
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 900,
    });
    expect(renovacao).toMatchObject({ name: 'rpa_renovacao', value: 'renovacao-nova' });
    expect(renovacao?.maxAge).toBe(30 * 24 * 60 * 60);
  });

  it('só marca Secure em produção', () => {
    expect(montarCookies(tokensFicticios(), false).every((cookie) => !cookie.secure)).toBe(true);
  });

  it('grava a empresa por um ano, sem expor ao JavaScript', () => {
    expect(cookieEmpresa('roma', true)).toEqual({
      name: 'rpa_empresa',
      value: 'roma',
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 365 * 24 * 60 * 60,
    });
  });

  it('apaga acesso e renovação, mantendo a empresa', () => {
    const apagados = cookiesApagados(false);
    expect(apagados.map((cookie) => [cookie.name, cookie.value, cookie.maxAge])).toEqual([
      ['rpa_acesso', '', 0],
      ['rpa_renovacao', '', 0],
    ]);
  });
});

describe('origemPermitida', () => {
  const req = (origem?: string) =>
    new Request('http://site.teste/x', {
      method: 'POST',
      headers: origem ? { origin: origem } : {},
    });

  it('aceita só a origem exata do site', () => {
    expect(origemPermitida(req('https://site.exemplo'), 'https://site.exemplo/')).toBe(true);
    expect(origemPermitida(req('https://outro.exemplo'), 'https://site.exemplo')).toBe(false);
    expect(origemPermitida(req('http://site.exemplo'), 'https://site.exemplo')).toBe(false);
    expect(origemPermitida(req('null'), 'https://site.exemplo')).toBe(false);
  });

  it('recusa sem Origin', () => {
    expect(origemPermitida(req(), 'https://site.exemplo')).toBe(false);
  });
});

describe('caminhoPermitido', () => {
  it.each(['/v1/eu', '/v1/empresas/aba/artes', '/v1/cores', '/v1/cores/1', '/v1/maquinas'])(
    'permite %s',
    (caminho) => {
      expect(caminhoPermitido(caminho)).toBe(true);
    },
  );

  it.each([
    '/v1/auth/entrar',
    '/v1/auth/renovar',
    '/v1/saude',
    '/v1/empresas/',
    '/v1/empresas',
    '/v1/eux',
    '/v1/coresx',
    '/v1/empresas/aba/%2e%2e/%2e%2e/auth/sair',
    '/v1/empresas/aba%2f..%2f..%2fauth',
    '/v1/empresas/aba%5c..',
    '/v1/empresas/aba/../../auth',
    '/v1/eu\\..\\auth',
  ])('recusa %s', (caminho) => {
    expect(caminhoPermitido(caminho)).toBe(false);
  });
});

describe('destinoSeguro', () => {
  it.each([
    ['/aba/artes', '/aba/artes'],
    ['/aba/artes?pagina=2', '/aba/artes?pagina=2'],
    ['/aba/./artes#topo', '/aba/artes'],
    ['/aba/../roma/artes', '/roma/artes'],
  ])('aceita %s', (destino, esperado) => {
    expect(destinoSeguro(destino)).toBe(esperado);
  });

  it.each([
    undefined,
    ['/aba'],
    '',
    'aba/artes',
    'https://mal.exemplo/aba',
    '//mal.exemplo/aba',
    '/\\mal.exemplo',
    '/\t/mal.exemplo',
    '/.//mal.exemplo',
    'javascript:alert(1)',
    '/entrar',
    '/api/sessao/sair',
    '/_next/static/x.js',
    `/${'a'.repeat(2048)}`,
  ])('recusa %j', (destino) => {
    expect(destinoSeguro(destino)).toBeUndefined();
  });

  it('mantém barras codificadas como caminho local', () => {
    const destino = destinoSeguro('/%2f%2fmal.exemplo');
    expect(destino).toBe('/%2f%2fmal.exemplo');
    expect(new URL(destino ?? '', 'https://site.exemplo').origin).toBe('https://site.exemplo');
  });
});

describe('empresaInicial', () => {
  const eu = {
    empresas: [
      { slug: 'aba', nome: 'ABA' },
      { slug: 'roma', nome: 'Roma' },
    ],
  };

  it('usa a empresa do cookie quando o usuário tem acesso a ela', () => {
    expect(empresaInicial(eu, 'roma')).toBe('roma');
  });

  it('cai na primeira empresa sem cookie ou com empresa alheia', () => {
    expect(empresaInicial(eu, undefined)).toBe('aba');
    expect(empresaInicial(eu, 'outra')).toBe('aba');
  });

  it('a primeira é a do topo do seletor (ordem do nome), não a da API', () => {
    const fora = { empresas: [{ slug: 'zeta', nome: 'Zeta' }, ...eu.empresas] };
    expect(empresaInicial(fora, undefined)).toBe('aba');
  });

  it('não tem empresa inicial para quem não tem empresa', () => {
    expect(empresaInicial({ empresas: [] }, 'aba')).toBeUndefined();
  });
});
