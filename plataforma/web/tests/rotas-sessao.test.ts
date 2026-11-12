import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { POST as escolherEmpresa } from '../src/app/api/sessao/empresa/route';
import { POST as entrar } from '../src/app/api/sessao/entrar/route';
import { POST as sair } from '../src/app/api/sessao/sair/route';
import { POST as trocarSenha } from '../src/app/api/sessao/senha/route';
import {
  API_URL,
  apiFalsa,
  corpoJson,
  formulario,
  requisicao,
  respostaEntrar,
  SITE_URL,
  tokenAcesso,
  tokensFicticios,
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
    expect(resposta.headers.get('location')).toBe(`${SITE_URL}/aba`);
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

    expect(resposta.headers.get('location')).toBe(`${SITE_URL}/roma`);
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

    expect(resposta.headers.get('location')).toBe(`${SITE_URL}/aba`);
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
    expect(resposta.headers.get('location')).toBe(`${SITE_URL}/roma`);
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

describe('POST /api/sessao/senha', () => {
  const acesso = () => tokenAcesso(Date.now() + 10 * 60 * 1000);
  const campos = {
    senhaAtual: 'senha-inicial-123',
    novaSenha: 'senha-nova-456789',
    confirmacao: 'senha-nova-456789',
    empresa: 'roma',
  };
  const postSenha = (
    valores: Record<string, string>,
    cookies: Record<string, string> = { rpa_acesso: acesso(), rpa_renovacao: 'renovacao-atual' },
    origem = SITE_URL,
  ) =>
    trocarSenha(
      requisicao('/api/sessao/senha', {
        metodo: 'POST',
        origem,
        corpo: formulario(valores),
        cookies,
      }),
    );

  it('troca mantendo a sessão deste navegador e volta para a empresa', async () => {
    const { chamadas } = apiFalsa({
      'POST /v1/eu/senha': () => new Response(null, { status: 204 }),
    });

    const resposta = await postSenha(campos);

    expect(resposta.status).toBe(303);
    expect(resposta.headers.get('location')).toBe(`${SITE_URL}/roma`);
    expect(corpoJson(chamadas[0])).toEqual({
      senhaAtual: campos.senhaAtual,
      novaSenha: campos.novaSenha,
      renovacao: 'renovacao-atual',
    });
    expect(new Headers(chamadas[0]?.init.headers).get('authorization')).toMatch(/^Bearer /);
  });

  it('com o acesso renovado agora, manda a renovação nova e grava os cookies', async () => {
    const tokens = tokensFicticios();
    const { chamadas } = apiFalsa({
      'POST /v1/auth/renovar': () => Response.json(tokens),
      'POST /v1/eu/senha': () => new Response(null, { status: 204 }),
    });

    const resposta = await postSenha(campos, { rpa_renovacao: 'renovacao-velha' });

    expect(resposta.status).toBe(303);
    expect(corpoJson(chamadas[1])).toMatchObject({ renovacao: tokens.renovacao });
    expect(resposta.cookies.get('rpa_renovacao')?.value).toBe(tokens.renovacao);
  });

  it.each<[Record<string, string>, string]>([
    [{ ...campos, novaSenha: 'curta', confirmacao: 'curta' }, 'senha_curta'],
    [{ ...campos, confirmacao: 'outra-senha-123' }, 'confirmacao'],
  ])('recusa sem chamar a API: %j → %s', async (valores, codigo) => {
    const { chamadas } = apiFalsa({});

    const resposta = await postSenha(valores);

    expect(resposta.headers.get('location')).toBe(`${SITE_URL}/trocar-senha?erro=${codigo}`);
    expect(chamadas).toHaveLength(0);
  });

  it('recusa da API volta com o código dela', async () => {
    apiFalsa({
      'POST /v1/eu/senha': () =>
        Response.json(
          { erro: { codigo: 'senha_atual_incorreta', mensagem: 'Senha atual incorreta.' } },
          { status: 400 },
        ),
    });

    const resposta = await postSenha(campos);

    expect(resposta.headers.get('location')).toBe(
      `${SITE_URL}/trocar-senha?erro=senha_atual_incorreta`,
    );
  });

  it('sem sessão: vai para /entrar e apaga os cookies', async () => {
    apiFalsa({});

    const resposta = await postSenha(campos, {});

    expect(resposta.headers.get('location')).toBe(`${SITE_URL}/entrar`);
    expect(resposta.cookies.get('rpa_acesso')?.value).toBe('');
  });

  describe('Minha conta (retorno=conta)', () => {
    const daConta = { ...campos, retorno: 'conta' };

    it('volta para a Minha conta com ok=1, mantendo a sessão deste navegador', async () => {
      const { chamadas } = apiFalsa({
        'POST /v1/eu/senha': () => new Response(null, { status: 204 }),
      });

      const resposta = await postSenha(daConta);

      expect(resposta.status).toBe(303);
      expect(resposta.headers.get('location')).toBe(`${SITE_URL}/roma/conta?ok=1`);
      expect(corpoJson(chamadas[0])).toMatchObject({ renovacao: 'renovacao-atual' });
    });

    it.each<[Record<string, string>, string]>([
      [{ ...daConta, novaSenha: 'curta', confirmacao: 'curta' }, 'senha_curta'],
      [{ ...daConta, confirmacao: 'outra-senha-123' }, 'confirmacao'],
    ])('recusa local volta para a conta: %j → %s', async (valores, codigo) => {
      apiFalsa({});

      const resposta = await postSenha(valores);

      expect(resposta.headers.get('location')).toBe(`${SITE_URL}/roma/conta?erro=${codigo}`);
    });

    it('recusa da API volta para a conta com o código dela', async () => {
      apiFalsa({
        'POST /v1/eu/senha': () =>
          Response.json(
            { erro: { codigo: 'senha_atual_incorreta', mensagem: 'Senha atual incorreta.' } },
            { status: 400 },
          ),
      });

      const resposta = await postSenha(daConta);

      expect(resposta.headers.get('location')).toBe(
        `${SITE_URL}/roma/conta?erro=senha_atual_incorreta`,
      );
    });

    it.each<Record<string, string>>([
      { ...campos, retorno: 'https://mal.exemplo' },
      { ...campos, retorno: '//mal.exemplo' },
      { ...daConta, empresa: '../mal' },
      { ...daConta, empresa: '' },
    ])('retorno ou empresa fora da lista seguem o primeiro acesso: %j', async (valores) => {
      apiFalsa({});

      const resposta = await postSenha({ ...valores, confirmacao: 'diferente-123' });

      expect(resposta.headers.get('location')).toBe(`${SITE_URL}/trocar-senha?erro=confirmacao`);
    });
  });

  it('recusa com 403 o POST de outra origem', async () => {
    const { chamadas } = apiFalsa({});

    const resposta = await postSenha(campos, undefined, 'https://mal.exemplo');

    expect(resposta.status).toBe(403);
    expect(chamadas).toHaveLength(0);
  });
});
