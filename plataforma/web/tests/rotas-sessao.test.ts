import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { POST as escolherEmpresa } from '../src/app/api/sessao/empresa/route';
import { POST as entrar } from '../src/app/api/sessao/entrar/route';
import { POST as sair } from '../src/app/api/sessao/sair/route';
import {
  API_URL,
  apiFalsa,
  corpoJson,
  formulario,
  requisicao,
  respostaEntrar,
  SITE_URL,
} from './apoio/api-falsa';

beforeEach(() => {
  vi.stubEnv('API_URL_INTERNA', API_URL);
  vi.stubEnv('SITE_URL', SITE_URL);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const postEntrar = (campos: Record<string, string>, cookies: Record<string, string> = {}) =>
  entrar(
    requisicao('/api/sessao/entrar', {
      metodo: 'POST',
      origem: SITE_URL,
      corpo: formulario(campos),
      cookies,
    }),
  );

describe('POST /api/sessao/entrar', () => {
  it('entra com origem web, grava os cookies e vai para a primeira empresa', async () => {
    const dados = respostaEntrar(['aba', 'roma']);
    const { chamadas } = apiFalsa({ 'POST /v1/auth/entrar': () => Response.json(dados) });

    const resposta = await postEntrar({ email: 'pessoa@exemplo.com', senha: 'senha-ficticia' });

    expect(resposta.status).toBe(303);
    expect(resposta.headers.get('location')).toBe(`${SITE_URL}/aba/artes`);
    expect(corpoJson(chamadas[0])).toEqual({
      email: 'pessoa@exemplo.com',
      senha: 'senha-ficticia',
      origem: 'web',
    });
    expect(resposta.cookies.get('rpa_acesso')).toMatchObject({
      value: dados.acesso,
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
    });
    expect(resposta.cookies.get('rpa_renovacao')?.value).toBe(dados.renovacao);
  });

  it('prefere a empresa do cookie rpa_empresa quando o usuário tem acesso', async () => {
    apiFalsa({ 'POST /v1/auth/entrar': () => Response.json(respostaEntrar(['aba', 'roma'])) });

    const resposta = await postEntrar(
      { email: 'pessoa@exemplo.com', senha: 'senha-ficticia' },
      { rpa_empresa: 'roma' },
    );

    expect(resposta.headers.get('location')).toBe(`${SITE_URL}/roma/artes`);
  });

  it('vai para o destino interno pedido', async () => {
    apiFalsa({ 'POST /v1/auth/entrar': () => Response.json(respostaEntrar()) });

    const resposta = await postEntrar({
      email: 'pessoa@exemplo.com',
      senha: 'senha-ficticia',
      destino: '/roma/artes?pagina=2',
    });

    expect(resposta.headers.get('location')).toBe(`${SITE_URL}/roma/artes?pagina=2`);
  });

  it('ignora destino externo (sem redirecionamento aberto)', async () => {
    apiFalsa({ 'POST /v1/auth/entrar': () => Response.json(respostaEntrar(['aba'])) });

    const resposta = await postEntrar({
      email: 'pessoa@exemplo.com',
      senha: 'senha-ficticia',
      destino: '//mal.exemplo/aba',
    });

    expect(resposta.headers.get('location')).toBe(`${SITE_URL}/aba/artes`);
  });

  it.each([401, 403, 400, 500])(
    'volta para /entrar?erro=1 sem cookies quando a API responde %i',
    async (status) => {
      apiFalsa({ 'POST /v1/auth/entrar': () => new Response(null, { status }) });

      const resposta = await postEntrar({
        email: 'pessoa@exemplo.com',
        senha: 'errada',
        destino: '/roma/artes',
      });

      expect(resposta.status).toBe(303);
      expect(resposta.headers.get('location')).toBe(
        `${SITE_URL}/entrar?erro=1&destino=%2Froma%2Fartes`,
      );
      expect(resposta.cookies.get('rpa_acesso')).toBeUndefined();
    },
  );

  it('volta com erro quando a API está fora do ar', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const resposta = await postEntrar({ email: 'pessoa@exemplo.com', senha: 'senha-ficticia' });

    expect(resposta.headers.get('location')).toBe(`${SITE_URL}/entrar?erro=1`);
  });

  it('volta com erro sem chamar a API quando faltam campos', async () => {
    const { buscar } = apiFalsa({});

    const resposta = await postEntrar({ email: 'pessoa@exemplo.com' });

    expect(resposta.headers.get('location')).toBe(`${SITE_URL}/entrar?erro=1`);
    expect(buscar).not.toHaveBeenCalled();
  });

  it('recusa com 403 o POST de outra origem (CSRF de login)', async () => {
    const { buscar } = apiFalsa({});

    const resposta = await entrar(
      requisicao('/api/sessao/entrar', {
        metodo: 'POST',
        origem: 'https://mal.exemplo',
        corpo: formulario({ email: 'pessoa@exemplo.com', senha: 'senha-ficticia' }),
      }),
    );

    expect(resposta.status).toBe(403);
    expect(buscar).not.toHaveBeenCalled();
  });
});

describe('POST /api/sessao/sair', () => {
  it('revoga a sessão na API, apaga os cookies e vai para /entrar', async () => {
    const { chamadas } = apiFalsa({
      'POST /v1/auth/sair': () => new Response(null, { status: 204 }),
    });

    const resposta = await sair(
      requisicao('/api/sessao/sair', {
        metodo: 'POST',
        origem: SITE_URL,
        cookies: { rpa_acesso: 'acesso-antigo', rpa_renovacao: 'renovacao-antiga' },
      }),
    );

    expect(resposta.status).toBe(303);
    expect(resposta.headers.get('location')).toBe(`${SITE_URL}/entrar`);
    expect(corpoJson(chamadas[0])).toEqual({ renovacao: 'renovacao-antiga' });
    expect(resposta.cookies.get('rpa_acesso')).toMatchObject({ value: '', maxAge: 0 });
    expect(resposta.cookies.get('rpa_renovacao')).toMatchObject({ value: '', maxAge: 0 });
  });

  it('apaga os cookies mesmo com a API fora do ar', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const resposta = await sair(
      requisicao('/api/sessao/sair', {
        metodo: 'POST',
        origem: SITE_URL,
        cookies: { rpa_renovacao: 'renovacao-antiga' },
      }),
    );

    expect(resposta.status).toBe(303);
    expect(resposta.cookies.get('rpa_renovacao')).toMatchObject({ value: '', maxAge: 0 });
  });

  it('sem cookie de renovação, só apaga e redireciona', async () => {
    const { buscar } = apiFalsa({});

    const resposta = await sair(
      requisicao('/api/sessao/sair', { metodo: 'POST', origem: SITE_URL }),
    );

    expect(resposta.status).toBe(303);
    expect(buscar).not.toHaveBeenCalled();
  });

  it('recusa com 403 o POST de outra origem', async () => {
    const { buscar } = apiFalsa({});

    const resposta = await sair(
      requisicao('/api/sessao/sair', {
        metodo: 'POST',
        origem: 'https://mal.exemplo',
        cookies: { rpa_renovacao: 'renovacao-antiga' },
      }),
    );

    expect(resposta.status).toBe(403);
    expect(buscar).not.toHaveBeenCalled();
  });
});

describe('POST /api/sessao/empresa', () => {
  const postEmpresa = (campos: Record<string, string>, origem = SITE_URL) =>
    escolherEmpresa(
      requisicao('/api/sessao/empresa', { metodo: 'POST', origem, corpo: formulario(campos) }),
    );

  it('grava rpa_empresa e vai para as artes da empresa escolhida', async () => {
    const resposta = await postEmpresa({ empresa: 'roma' });

    expect(resposta.status).toBe(303);
    expect(resposta.headers.get('location')).toBe(`${SITE_URL}/roma/artes`);
    expect(resposta.cookies.get('rpa_empresa')).toMatchObject({
      value: 'roma',
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
    });
  });

  it.each<Record<string, string>>([
    {},
    { empresa: '' },
    { empresa: '../entrar' },
    { empresa: '//mal.exemplo' },
  ])('recusa com 400 a empresa inválida %j', async (campos) => {
    const resposta = await postEmpresa(campos);

    expect(resposta.status).toBe(400);
    expect(resposta.cookies.get('rpa_empresa')).toBeUndefined();
  });

  it('recusa com 403 o POST de outra origem', async () => {
    const resposta = await postEmpresa({ empresa: 'roma' }, 'https://mal.exemplo');

    expect(resposta.status).toBe(403);
    expect(resposta.cookies.get('rpa_empresa')).toBeUndefined();
  });
});
