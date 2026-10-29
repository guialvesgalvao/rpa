import { describe, expect, it } from 'vitest';

import { criarCliente, ErroIndisponivel, ErroRecusado } from '../../../src/app/plataforma/cliente.js';

const EU = {
  id: '3f0c6d2e-8a41-4b5e-9d3a-1c2b3d4e5f60',
  nome: 'Usuário Teste',
  email: 'teste@example.com',
  perfil: 'admin',
  empresas: [{ slug: 'aba', nome: 'ABA' }],
};

const TOKENS = { acesso: 'acesso-1', renovacao: 'renovacao-1', expiraEm: '2030-01-01T00:15:00.000Z' };

type Chamada = { url: string; init: RequestInit };

function fetchFalso(responder: (chamada: Chamada) => Response | Promise<Response>) {
  const chamadas: Chamada[] = [];
  const fake = (async (url: string | URL | Request, init?: RequestInit) => {
    const chamada = { url: String(url), init: init ?? {} };
    chamadas.push(chamada);
    return responder(chamada);
  }) as typeof fetch;
  return { fake, chamadas };
}

const json = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { 'content-type': 'application/json' } });

describe('criarCliente', () => {
  it('entrar envia e-mail, senha e origem desktop e valida a resposta', async () => {
    const { fake, chamadas } = fetchFalso(() => json({ ...TOKENS, eu: EU }));
    const cliente = criarCliente({ baseUrl: 'http://api.local/', fetch: fake });

    const resposta = await cliente.entrar('teste@example.com', 'segredo');

    expect(resposta.eu.perfil).toBe('admin');
    expect(chamadas[0]?.url).toBe('http://api.local/v1/auth/entrar');
    expect(chamadas[0]?.init.method).toBe('POST');
    expect(JSON.parse(String(chamadas[0]?.init.body))).toEqual({
      email: 'teste@example.com',
      senha: 'segredo',
      origem: 'desktop',
    });
  });

  it('renovar e sair enviam o token de renovação', async () => {
    const { fake, chamadas } = fetchFalso(({ url }) =>
      url.endsWith('/sair') ? new Response(null, { status: 204 }) : json(TOKENS),
    );
    const cliente = criarCliente({ baseUrl: 'http://api.local', fetch: fake });

    expect(await cliente.renovar('antigo')).toEqual(TOKENS);
    await cliente.sair('antigo');

    expect(chamadas.map((c) => c.url)).toEqual([
      'http://api.local/v1/auth/renovar',
      'http://api.local/v1/auth/sair',
    ]);
    expect(JSON.parse(String(chamadas[1]?.init.body))).toEqual({ renovacao: 'antigo' });
  });

  it('eu envia o token de acesso no cabeçalho Authorization', async () => {
    const { fake, chamadas } = fetchFalso(() => json(EU));
    const cliente = criarCliente({ baseUrl: 'http://api.local', fetch: fake });

    expect((await cliente.eu('meu-acesso')).email).toBe('teste@example.com');
    expect(chamadas[0]?.init.method).toBe('GET');
    expect(chamadas[0]?.init.headers).toMatchObject({ authorization: 'Bearer meu-acesso' });
  });

  it.each([401, 403])('HTTP %i vira ErroRecusado com o código da API', async (status) => {
    const { fake } = fetchFalso(() =>
      json({ erro: { codigo: 'credenciais_invalidas', mensagem: 'E-mail ou senha inválidos.' } }, status),
    );
    const cliente = criarCliente({ baseUrl: 'http://api.local', fetch: fake });

    await expect(cliente.entrar('a@b.com', 'x')).rejects.toMatchObject({
      name: 'ErroRecusado',
      status,
      codigo: 'credenciais_invalidas',
    });
  });

  it('401 sem corpo do contrato ainda é ErroRecusado', async () => {
    const { fake } = fetchFalso(() => new Response('nope', { status: 401 }));
    const cliente = criarCliente({ baseUrl: 'http://api.local', fetch: fake });

    await expect(cliente.renovar('x')).rejects.toBeInstanceOf(ErroRecusado);
  });

  it('falha de rede, 5xx e resposta fora do contrato viram ErroIndisponivel', async () => {
    const cenarios: Array<() => Response | Promise<Response>> = [
      () => {
        throw new TypeError('fetch failed');
      },
      () => new Response('erro', { status: 503 }),
      () => json({ qualquer: 'coisa' }),
      () => new Response('não é json', { status: 200 }),
    ];
    for (const cenario of cenarios) {
      const { fake } = fetchFalso(cenario);
      const cliente = criarCliente({ baseUrl: 'http://api.local', fetch: fake });
      await expect(cliente.renovar('x')).rejects.toBeInstanceOf(ErroIndisponivel);
    }
  });
});
