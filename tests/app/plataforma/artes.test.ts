import { describe, expect, it } from 'vitest';

import {
  artesDoItem,
  criarClienteArtes,
  ErroRequisicao,
  normalizarCnpj,
  TTL_CORES_MS,
} from '../../../src/app/plataforma/artes.js';
import { ErroIndisponivel, ErroRecusado } from '../../../src/app/plataforma/cliente.js';

// Dados sintéticos: ids, CNPJs e nomes fictícios.
const CLIENTE = '3f0c6d2e-8a41-4b5e-9d3a-1c2b3d4e5f60';
const PRODUTO = '11111111-1111-4111-8111-111111111111';
const OUTRO_PRODUTO = '22222222-2222-4222-8222-222222222222';
const ARTE = '33333333-3333-4333-8333-333333333333';
const COR = { id: '44444444-4444-4444-8444-444444444444', nome: 'Azul' };
const MAQUINA = { id: '55555555-5555-4555-8555-555555555555', nome: 'Favorit' };

const cliente = (cnpj: string) => ({
  id: CLIENTE,
  nomeExibicao: 'Padaria Exemplo',
  razaoSocial: 'Padaria Exemplo Ltda',
  nomeFantasia: 'Padaria Exemplo',
  cnpj,
});

const arte = {
  id: ARTE,
  nome: 'Padrão',
  cor: COR,
  maquinas: [MAQUINA],
  criadoEm: '2026-10-30T12:00:00.000Z',
  temPdf: true,
  temImagem: true,
};

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

const json = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { 'content-type': 'application/json' } });

const erroApi = (status: number, codigo = 'x') =>
  json({ erro: { codigo, mensagem: 'mensagem da API' } }, status);

function api(responder: (url: string) => Response | Promise<Response>) {
  const urls: string[] = [];
  const headers: unknown[] = [];
  const fake = (async (url: string | URL | Request, init?: RequestInit) => {
    urls.push(String(url));
    headers.push(init?.headers);
    return responder(String(url));
  }) as typeof fetch;
  return {
    urls,
    headers,
    cliente: criarClienteArtes({
      baseUrl: 'http://api.local/',
      fetch: fake,
      obterAcesso: async () => 'acesso-1',
    }),
  };
}

describe('normalizarCnpj', () => {
  it('tira a máscara e exige 14 dígitos', () => {
    expect(normalizarCnpj('12.345.678/0001-90')).toBe('12345678000190');
    expect(normalizarCnpj('123.456.789-09')).toBeNull();
    expect(normalizarCnpj('')).toBeNull();
  });
});

describe('clientePorCnpj', () => {
  it('busca pelos 14 dígitos e devolve só o cliente com o CNPJ exato', async () => {
    const { cliente: c, urls, headers } = api(() =>
      json({ itens: [cliente('12345678000190')], proximoCursor: null }),
    );

    expect(await c.clientePorCnpj('roma', '12.345.678/0001-90')).toMatchObject({ id: CLIENTE });
    expect(urls).toEqual(['http://api.local/v1/empresas/roma/clientes?busca=12345678000190']);
    expect(headers[0]).toEqual({ authorization: 'Bearer acesso-1' });
  });

  it('sem cliente com o CNPJ exato devolve null', async () => {
    const { cliente: c } = api(() =>
      json({ itens: [cliente('99345678000190')], proximoCursor: null }),
    );

    expect(await c.clientePorCnpj('roma', '12345678000190')).toBeNull();
  });

  it('CNPJ incompleto devolve null sem chamar a API', async () => {
    const { cliente: c, urls } = api(() => json({ itens: [], proximoCursor: null }));

    expect(await c.clientePorCnpj('roma', '123')).toBeNull();
    expect(urls).toEqual([]);
  });
});

describe('artesDoProduto', () => {
  it('chama a rota do cliente e do produto e valida o contrato', async () => {
    const { cliente: c, urls } = api(() => json([arte]));

    expect(await c.artesDoProduto('roma', CLIENTE, PRODUTO)).toEqual([arte]);
    expect(urls).toEqual([
      `http://api.local/v1/empresas/roma/clientes/${CLIENTE}/produtos/${PRODUTO}/artes`,
    ]);
  });

  it('404 vira ErroRequisicao; 403 vira ErroRecusado', async () => {
    const naoEncontrado = await api(() => erroApi(404, 'produto_nao_encontrado'))
      .cliente.artesDoProduto('roma', CLIENTE, PRODUTO)
      .catch((e: unknown) => e);
    expect(naoEncontrado).toBeInstanceOf(ErroRequisicao);
    expect(naoEncontrado).toMatchObject({ status: 404, codigo: 'produto_nao_encontrado' });

    await expect(
      api(() => erroApi(403)).cliente.artesDoProduto('roma', CLIENTE, PRODUTO),
    ).rejects.toBeInstanceOf(ErroRecusado);
  });

  it('resposta fora do contrato e rede caída viram ErroIndisponivel', async () => {
    await expect(
      api(() => json([{ ...arte, criadoEm: '30/10/2026' }])).cliente.artesDoProduto(
        'roma',
        CLIENTE,
        PRODUTO,
      ),
    ).rejects.toBeInstanceOf(ErroIndisponivel);
    await expect(
      api(() => {
        throw new TypeError('fetch failed');
      }).cliente.artesDoProduto('roma', CLIENTE, PRODUTO),
    ).rejects.toThrow('Sem conexão com o servidor.');
  });
});

describe('imagemDaArte', () => {
  it('baixa a imagem e confere o tipo pelos bytes, não pelo cabeçalho', async () => {
    const { cliente: c, urls } = api(
      () => new Response(PNG, { headers: { 'content-type': 'image/jpeg' } }),
    );

    const imagem = await c.imagemDaArte('roma', ARTE);

    expect(urls).toEqual([`http://api.local/v1/empresas/roma/artes/${ARTE}/imagem`]);
    expect(imagem.mime).toBe('image/png');
    expect([...imagem.bytes]).toEqual([...PNG]);
  });

  it('conteúdo que não é imagem vira ErroIndisponivel', async () => {
    const pdf = new TextEncoder().encode('%PDF-1.4\n');
    await expect(
      api(() => new Response(pdf)).cliente.imagemDaArte('roma', ARTE),
    ).rejects.toBeInstanceOf(ErroIndisponivel);
  });

  it('arte sem imagem (404) vira ErroRequisicao; 5xx vira ErroIndisponivel', async () => {
    await expect(
      api(() => erroApi(404, 'imagem_nao_encontrada')).cliente.imagemDaArte('roma', ARTE),
    ).rejects.toMatchObject({ name: 'ErroRequisicao', status: 404 });
    await expect(
      api(() => new Response('erro', { status: 503 })).cliente.imagemDaArte('roma', ARTE),
    ).rejects.toBeInstanceOf(ErroIndisponivel);
  });
});

describe('artesDoItem', () => {
  const produtos = [
    { id: OUTRO_PRODUTO, nome: 'Sacola', codigo: null, quantidadeArtes: 1 },
    { id: PRODUTO, nome: 'Oitavada', codigo: 'RA0012', quantidadeArtes: 2 },
  ];

  it('casa o código do item com o produto do cliente e lista as artes dele', async () => {
    const { cliente: c, urls } = api((url) => (url.endsWith('/produtos') ? json(produtos) : json([arte])));

    expect(await artesDoItem(c, 'roma', CLIENTE, ' RA0012 ')).toEqual({
      produtoId: PRODUTO,
      artes: [arte],
    });
    expect(urls).toEqual([
      `http://api.local/v1/empresas/roma/clientes/${CLIENTE}/produtos`,
      `http://api.local/v1/empresas/roma/clientes/${CLIENTE}/produtos/${PRODUTO}/artes`,
    ]);
  });

  it('sem produto com o código, fica sem arte e não lista artes', async () => {
    const { cliente: c, urls } = api(() => json(produtos));

    expect(await artesDoItem(c, 'roma', CLIENTE, 'EP0006')).toEqual({ produtoId: null, artes: [] });
    expect(urls).toHaveLength(1);
  });

  it('API anterior ao código (campo ausente) também fica sem arte', async () => {
    const semCodigo = produtos.map(({ codigo: _codigo, ...resto }) => resto);
    const { cliente: c } = api(() => json(semCodigo));

    expect(await artesDoItem(c, 'roma', CLIENTE, 'RA0012')).toEqual({ produtoId: null, artes: [] });
  });

  it('erro da API sobe para o main', async () => {
    await expect(
      artesDoItem(api(() => erroApi(403)).cliente, 'roma', CLIENTE, 'RA0012'),
    ).rejects.toBeInstanceOf(ErroRecusado);
  });
});

describe('redefinirSenhaUsuario', () => {
  it('envia a senha nova em JSON por POST na rota do usuário', async () => {
    const chamadas: RequestInit[] = [];
    const urls: string[] = [];
    const c = criarClienteArtes({
      baseUrl: 'http://api.local',
      fetch: (async (url: string | URL | Request, init?: RequestInit) => {
        urls.push(String(url));
        chamadas.push(init ?? {});
        return new Response(null, { status: 204 });
      }) as typeof fetch,
      obterAcesso: async () => 'acesso-1',
    });

    await c.redefinirSenhaUsuario('aba', ARTE, '1234567890');
    expect(urls).toEqual([`http://api.local/v1/empresas/aba/usuarios/${ARTE}/senha`]);
    expect(chamadas[0]?.method).toBe('POST');
    expect(JSON.parse(String(chamadas[0]?.body))).toEqual({ novaSenha: '1234567890' });
  });

  it('recusa da API (a própria senha, sem permissão) sobe com a mensagem dela', async () => {
    await expect(
      api(() => erroApi(409, 'proprio_usuario')).cliente.redefinirSenhaUsuario('aba', ARTE, 'x'),
    ).rejects.toMatchObject({ codigo: 'proprio_usuario', message: 'mensagem da API' });
    await expect(
      api(() => erroApi(403)).cliente.redefinirSenhaUsuario('aba', ARTE, 'x'),
    ).rejects.toBeInstanceOf(ErroRecusado);
  });
});

describe('reservarNumerosOp', () => {
  it('envia a quantidade em JSON por POST e devolve os números', async () => {
    const chamadas: RequestInit[] = [];
    const urls: string[] = [];
    const c = criarClienteArtes({
      baseUrl: 'http://api.local',
      fetch: (async (url: string | URL | Request, init?: RequestInit) => {
        urls.push(String(url));
        chamadas.push(init ?? {});
        return json({ numeros: [7, 8] }, 201);
      }) as typeof fetch,
      obterAcesso: async () => 'acesso-1',
    });

    expect(await c.reservarNumerosOp('roma', 2)).toEqual([7, 8]);
    expect(urls).toEqual(['http://api.local/v1/empresas/roma/op/numeros']);
    expect(chamadas[0]?.method).toBe('POST');
    expect(chamadas[0]?.headers).toEqual({
      authorization: 'Bearer acesso-1',
      'content-type': 'application/json',
    });
    expect(JSON.parse(String(chamadas[0]?.body))).toEqual({ quantidade: 2 });
  });

  it('403 (perfil sem permissão) vira ErroRecusado; resposta fora do contrato, ErroIndisponivel', async () => {
    await expect(api(() => erroApi(403)).cliente.reservarNumerosOp('roma', 1)).rejects.toBeInstanceOf(
      ErroRecusado,
    );
    await expect(
      api(() => json({ numeros: [] }, 201)).cliente.reservarNumerosOp('roma', 1),
    ).rejects.toBeInstanceOf(ErroIndisponivel);
  });
});

describe('cache das cores', () => {
  const MAQUINAS = [MAQUINA];
  const NOVA = { id: '66666666-6666-4666-8666-666666666666', nome: 'Pantone 485' };

  function apiOpcoes(responderCores: () => Response) {
    let agora = 0;
    const chamadas: { url: string; init?: RequestInit }[] = [];
    const fake = (async (url: string | URL | Request, init?: RequestInit) => {
      const caminho = new URL(String(url)).pathname;
      chamadas.push({ url: caminho, ...(init ? { init } : {}) });
      if (caminho === '/v1/cores' && init?.method === 'POST') return json(NOVA, 201);
      if (caminho === '/v1/cores') return responderCores();
      if (caminho === '/v1/maquinas') return json(MAQUINAS);
      return json([]);
    }) as typeof fetch;
    const cliente = criarClienteArtes({
      baseUrl: 'http://api.local',
      fetch: fake,
      obterAcesso: async () => 'acesso-1',
      agora: () => agora,
    });
    const leiturasDeCores = () =>
      chamadas.filter((c) => c.url === '/v1/cores' && c.init?.method === 'GET').length;
    return { cliente, chamadas, leiturasDeCores, avancar: (ms: number) => (agora += ms) };
  }

  it('reaproveita as cores por 1 h; produtos e máquinas são lidos sempre', async () => {
    const { cliente: c, chamadas, leiturasDeCores, avancar } = apiOpcoes(() => json([COR]));

    expect((await c.opcoes('aba')).cores).toEqual([COR]);
    avancar(TTL_CORES_MS - 1);
    expect((await c.opcoes('aba')).cores).toEqual([COR]);
    expect(leiturasDeCores()).toBe(1);
    expect(chamadas.filter((x) => x.url === '/v1/maquinas')).toHaveLength(2);

    avancar(1);
    await c.opcoes('aba');
    expect(leiturasDeCores()).toBe(2);
  });

  it('a cor criada entra no cache sem reler a lista', async () => {
    const { cliente: c, chamadas, leiturasDeCores } = apiOpcoes(() => json([COR]));
    await c.opcoes('aba');

    expect(await c.criarCor('  Pantone 485 ')).toEqual(NOVA);
    const post = chamadas.find((x) => x.init?.method === 'POST');
    expect(JSON.parse(String(post?.init?.body))).toEqual({ nome: 'Pantone 485' });
    expect((await c.opcoes('aba')).cores).toEqual([COR, NOVA]);
    expect(leiturasDeCores()).toBe(1);
  });

  it('falha ao ler as cores não fica no cache', async () => {
    let falhar = true;
    const { cliente: c, leiturasDeCores } = apiOpcoes(() =>
      falhar ? erroApi(503) : json([COR]),
    );

    await expect(c.opcoes('aba')).rejects.toBeInstanceOf(ErroIndisponivel);
    falhar = false;
    expect((await c.opcoes('aba')).cores).toEqual([COR]);
    expect(leiturasDeCores()).toBe(2);
  });

  it('cor repetida vira ErroRequisicao com a mensagem da API', async () => {
    const fake = (async () => erroApi(409, 'cor_existente')) as unknown as typeof fetch;
    const c = criarClienteArtes({
      baseUrl: 'http://api.local',
      fetch: fake,
      obterAcesso: async () => 'acesso-1',
    });

    const falha = c.criarCor('4X4');
    await expect(falha).rejects.toBeInstanceOf(ErroRequisicao);
    await expect(falha).rejects.toMatchObject({ status: 409, message: 'mensagem da API' });
  });
});
