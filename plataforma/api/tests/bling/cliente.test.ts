import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  BASE_BLING,
  criarClienteBling,
  ErroBlingConcessaoInvalida,
  ErroBlingIndisponivel,
  ErroBlingNaoAutorizado,
  ErroBlingNaoEncontrado,
  INTERVALO_MINIMO_MS,
} from '../../src/bling/cliente.js';

// Só dados e credenciais fictícios.
type Chamada = { url: string; init: RequestInit; em: number };

const json = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { 'content-type': 'application/json' } });

function montar(responder: (chamada: Chamada, indice: number) => Response | Promise<Response>) {
  let agora = Date.parse('2026-01-05T12:00:00.000Z');
  const esperas: number[] = [];
  const chamadas: Chamada[] = [];
  const fake = (async (url: string | URL | Request, init?: RequestInit) => {
    const chamada = { url: String(url), init: init ?? {}, em: agora };
    chamadas.push(chamada);
    return responder(chamada, chamadas.length - 1);
  }) as typeof fetch;
  const cliente = criarClienteBling({
    fetch: fake,
    esperar: async (ms) => {
      esperas.push(ms);
      agora += ms;
    },
    relogio: () => new Date(agora),
  });
  return { cliente, chamadas, esperas };
}

const EsquemaItem = z.object({ id: z.number() });
const itens = (de: number, quantos: number) =>
  Array.from({ length: quantos }, (_, i) => ({ id: de + i }));
const acesso = async () => 'acesso-ficticio';
const CREDENCIAIS = { clientId: 'id-ficticio', clientSecret: 'segredo-ficticio' };

describe('listarTodas', () => {
  it('pagina de 100 em 100 até vir uma página incompleta', async () => {
    const { cliente, chamadas } = montar((_, i) =>
      json({ data: itens(i * 100, i < 2 ? 100 : 50) }),
    );
    const progresso: number[] = [];

    const lidos = await cliente.listarTodas(
      '/produtos',
      { criterio: 2 },
      EsquemaItem,
      acesso,
      (n) => progresso.push(n),
    );

    expect(lidos).toHaveLength(250);
    expect(lidos.at(-1)).toEqual({ id: 249 });
    expect(progresso).toEqual([100, 200, 250]);
    expect(chamadas.map((c) => c.url)).toEqual(
      [1, 2, 3].map((pagina) => `${BASE_BLING}/produtos?criterio=2&pagina=${pagina}&limite=100`),
    );
  });

  it('com o total múltiplo de 100, para na página vazia', async () => {
    const { cliente, chamadas } = montar((_, i) =>
      json({ data: i < 2 ? itens(i * 100, 100) : [] }),
    );
    expect(await cliente.listarTodas('/contatos', {}, EsquemaItem, acesso)).toHaveLength(200);
    expect(chamadas).toHaveLength(3);
  });

  it('usa só GET com o token de acesso, pedido a cada requisição', async () => {
    const { cliente, chamadas } = montar((_, i) => json({ data: itens(i * 100, i < 1 ? 100 : 0) }));
    let pedidos = 0;
    await cliente.listarTodas('/contatos', {}, EsquemaItem, async () => `acesso-${++pedidos}`);
    await cliente.obter('/contatos/1', z.object({ id: z.number() }), acesso).catch(() => {});

    expect(chamadas.every((c) => c.init.method === 'GET')).toBe(true);
    expect(chamadas.every((c) => c.init.body === undefined)).toBe(true);
    const autorizacoes = chamadas.map((c) => new Headers(c.init.headers).get('authorization'));
    expect(autorizacoes.slice(0, 2)).toEqual(['Bearer acesso-1', 'Bearer acesso-2']);
  });

  it('recusa página fora do esquema', async () => {
    const { cliente } = montar(() => json({ data: [{ id: 'texto' }] }));
    await expect(cliente.listarTodas('/produtos', {}, EsquemaItem, acesso)).rejects.toMatchObject({
      tipo: 'resposta_invalida',
    });
  });
});

describe('ritmo e 429', () => {
  it('espera ao menos 350 ms entre chamadas', async () => {
    const { cliente, chamadas } = montar((_, i) => json({ data: itens(i * 100, i < 4 ? 100 : 0) }));
    await cliente.listarTodas('/produtos', {}, EsquemaItem, acesso);

    expect(chamadas).toHaveLength(5);
    for (let i = 1; i < chamadas.length; i++)
      expect(chamadas[i]!.em - chamadas[i - 1]!.em).toBeGreaterThanOrEqual(INTERVALO_MINIMO_MS);
  });

  it('em 429 espera e tenta de novo', async () => {
    const { cliente, chamadas, esperas } = montar((_, i) =>
      i < 2 ? json({ error: { type: 'TOO_MANY_REQUESTS' } }, 429) : json({ data: { id: 7 } }),
    );
    expect(await cliente.obter('/contatos/7', EsquemaItem, acesso)).toEqual({ id: 7 });
    expect(chamadas).toHaveLength(3);
    expect(esperas.filter((ms) => ms === 1000)).toHaveLength(2);
  });

  it('desiste na quarta resposta 429', async () => {
    const { cliente, chamadas } = montar(() => json({ error: { type: 'TOO_MANY_REQUESTS' } }, 429));
    const erro = await cliente.obter('/contatos/7', EsquemaItem, acesso).catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(ErroBlingIndisponivel);
    expect(erro).toMatchObject({ tipo: 'TOO_MANY_REQUESTS', status: 429 });
    expect(chamadas).toHaveLength(4);
  });
});

describe('erros', () => {
  it('401 → não autorizado; 404 → não encontrado', async () => {
    const naoAutorizado = montar(() => json({ error: { type: 'invalid_token' } }, 401));
    await expect(
      naoAutorizado.cliente.obter('/contatos/1', EsquemaItem, acesso),
    ).rejects.toBeInstanceOf(ErroBlingNaoAutorizado);
    const naoEncontrado = montar(() => json({ error: { type: 'RESOURCE_NOT_FOUND' } }, 404));
    await expect(
      naoEncontrado.cliente.obter('/contatos/1', EsquemaItem, acesso),
    ).rejects.toBeInstanceOf(ErroBlingNaoEncontrado);
  });

  it('outros erros levam só o error.type, nunca o corpo', async () => {
    const { cliente } = montar(() =>
      json(
        { error: { type: 'SERVER_ERROR', message: 'detalhe-interno', description: 'Fulano' } },
        500,
      ),
    );
    const erro = (await cliente
      .obter('/contatos/1', EsquemaItem, acesso)
      .catch((e: unknown) => e)) as Error;
    expect(erro).toMatchObject({ tipo: 'SERVER_ERROR', status: 500 });
    expect(erro.message).not.toMatch(/detalhe-interno|Fulano/);
  });

  it('error.type que não é identificador simples não é repassado', async () => {
    const { cliente } = montar(() => json({ error: { type: 'Nome do Cliente <x>' } }, 500));
    await expect(cliente.obter('/contatos/1', EsquemaItem, acesso)).rejects.toMatchObject({
      tipo: 'erro_http',
    });
  });

  it('falha de rede → indisponível', async () => {
    const { cliente } = montar(() => {
      throw new TypeError('fetch failed');
    });
    await expect(cliente.obter('/contatos/1', EsquemaItem, acesso)).rejects.toMatchObject({
      tipo: 'rede',
    });
  });

  it('erro ao obter o token de acesso passa adiante sem virar erro de rede', async () => {
    const { cliente, chamadas } = montar(() => json({ data: { id: 1 } }));
    const falha = new Error('sem conexão');
    await expect(
      cliente.obter('/contatos/1', EsquemaItem, () => Promise.reject(falha)),
    ).rejects.toBe(falha);
    expect(chamadas).toHaveLength(0);
  });
});

describe('token', () => {
  const TOKEN = {
    access_token: 'acesso-novo',
    refresh_token: 'renovacao-nova',
    expires_in: 21_600,
  };

  it('faz POST no /oauth/token com Basic auth, form e enable-jwt', async () => {
    const { cliente, chamadas } = montar(() =>
      json({ ...TOKEN, token_type: 'Bearer', scope: 'x' }),
    );

    expect(
      await cliente.token(
        { grant_type: 'authorization_code', code: 'codigo-ficticio' },
        CREDENCIAIS,
      ),
    ).toEqual(TOKEN);

    const [chamada] = chamadas;
    expect(chamada?.url).toBe(`${BASE_BLING}/oauth/token`);
    expect(chamada?.init.method).toBe('POST');
    const headers = new Headers(chamada?.init.headers);
    expect(headers.get('authorization')).toBe(
      `Basic ${Buffer.from('id-ficticio:segredo-ficticio').toString('base64')}`,
    );
    expect(headers.get('content-type')).toBe('application/x-www-form-urlencoded');
    expect(headers.get('enable-jwt')).toBe('1');
    expect(headers.get('accept')).toBe('1.0');
    expect(Object.fromEntries(new URLSearchParams(String(chamada?.init.body)))).toEqual({
      grant_type: 'authorization_code',
      code: 'codigo-ficticio',
    });
  });

  it.each([
    ['padrão do Bling', { error: { type: 'invalid_grant', message: 'x' } }],
    ['padrão OAuth', { error: 'invalid_grant', error_description: 'x' }],
  ])('invalid_grant (%s) → concessão inválida', async (_, corpo) => {
    const { cliente } = montar(() => json(corpo, 400));
    await expect(
      cliente.token({ grant_type: 'refresh_token', refresh_token: 'r' }, CREDENCIAIS),
    ).rejects.toBeInstanceOf(ErroBlingConcessaoInvalida);
  });

  it('outros erros e resposta incompleta → indisponível', async () => {
    const erro = montar(() => json({ error: { type: 'invalid_client' } }, 401));
    await expect(erro.cliente.token({}, CREDENCIAIS)).rejects.toMatchObject({
      tipo: 'invalid_client',
      status: 401,
    });
    const incompleta = montar(() => json({ access_token: 'a' }));
    await expect(incompleta.cliente.token({}, CREDENCIAIS)).rejects.toMatchObject({
      tipo: 'resposta_invalida',
    });
  });
});
