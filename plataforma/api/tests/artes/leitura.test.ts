import {
  EsquemaArteDoProduto,
  EsquemaCliente,
  EsquemaErro,
  EsquemaOpcao,
  EsquemaPaginaClientes,
  EsquemaProdutoDoCliente,
  EsquemaRespostaEntrar,
  type Cliente,
  type PaginaClientes,
} from '@plataforma/contratos';
import { eq, inArray } from 'drizzle-orm';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { gerarCnpj, PDF_MINIMO, PNG_1X1 } from '../../src/cli/semear-dev.js';
import { normalizarTermo } from '../../src/artes/repositorio.js';
import {
  arquivos,
  arteMaquinas,
  artes,
  clientes,
  cores,
  empresas,
  maquinas,
  produtos,
} from '../../src/db/esquema.js';
import { criarUsuario } from '../../src/usuarios/servico.js';
import { criarAppTeste } from '../helpers/app.js';
import { criarBancoTeste, limparTabelas } from '../helpers/banco.js';
import { createHash } from 'node:crypto';

const { db, fechar } = criarBancoTeste();
afterAll(() => fechar());

const SENHA = 'senha-ficticia-123';

let app: FastifyInstance;
let acesso: string;

async function empresaId(slug: string) {
  const [linha] = await db.select().from(empresas).where(eq(empresas.slug, slug));
  if (!linha) throw new Error(`empresa ${slug} não semeada`);
  return linha.id;
}

async function entrar(email: string, empresasDoUsuario: string[]) {
  await criarUsuario(db, {
    email,
    nome: 'Usuária Teste',
    perfil: 'arte_finalista',
    senha: SENHA,
    empresas: empresasDoUsuario,
  });
  const resposta = await app.inject({
    method: 'POST',
    url: '/v1/auth/entrar',
    payload: { email, senha: SENHA, origem: 'web' },
  });
  return EsquemaRespostaEntrar.parse(resposta.json()).acesso;
}

beforeEach(async () => {
  await limparTabelas(db);
  ({ app } = criarAppTeste(db));
  acesso = await entrar('ana@exemplo.com', ['aba']);
});
afterEach(() => app.close());

const get = (url: string, token: string | null = acesso) =>
  app.inject({
    method: 'GET',
    url,
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });

function esperarErro(resposta: LightMyRequestResponse, status: number, codigo: string) {
  expect(resposta.statusCode).toBe(status);
  expect(EsquemaErro.parse(resposta.json()).erro.codigo).toBe(codigo);
}

let contadorCnpj = 0;
async function criarCliente(slug: string, razaoSocial: string, nomeFantasia: string | null = null) {
  const [cliente] = await db
    .insert(clientes)
    .values({
      empresaId: await empresaId(slug),
      razaoSocial,
      nomeFantasia,
      cnpj: gerarCnpj(++contadorCnpj),
    })
    .returning();
  if (!cliente) throw new Error('cliente não criado');
  return cliente;
}

async function criarProduto(slug: string, nome: string, codigo: string | null = null) {
  const [produto] = await db
    .insert(produtos)
    .values({ empresaId: await empresaId(slug), nome, codigo })
    .returning();
  if (!produto) throw new Error('produto não criado');
  return produto;
}

async function criarArte(slug: string, clienteId: string, produtoId: string, nome: string) {
  const [cor] = await db.select().from(cores).limit(1);
  const [maquina] = await db.select().from(maquinas).limit(1);
  const [arquivo] = await db
    .insert(arquivos)
    .values({
      nomeOriginal: 'arte.pdf',
      tipoMime: 'application/pdf',
      tamanho: PDF_MINIMO.length,
      sha256: createHash('sha256').update(PDF_MINIMO).digest('hex'),
      conteudo: PDF_MINIMO,
    })
    .returning();
  if (!cor || !maquina || !arquivo) throw new Error('referências ausentes');
  const [arte] = await db
    .insert(artes)
    .values({
      empresaId: await empresaId(slug),
      clienteId,
      produtoId,
      nome,
      corId: cor.id,
      pdfId: arquivo.id,
    })
    .returning();
  if (!arte) throw new Error('arte não criada');
  await db.insert(arteMaquinas).values({ arteId: arte.id, maquinaId: maquina.id });
}

async function pagina(consulta: string, token: string | null = acesso): Promise<PaginaClientes> {
  const resposta = await get(`/v1/empresas/aba/clientes${consulta}`, token);
  expect(resposta.statusCode).toBe(200);
  return EsquemaPaginaClientes.parse(resposta.json());
}

describe('normalizarTermo', () => {
  it('tira acento, caixa e espaços repetidos', () => {
    expect(normalizarTermo('  Açaí   TROPICAL ')).toBe('acai tropical');
  });

  it('mantém a pontuação quando não há dígitos', () => {
    expect(normalizarTermo('Beira-Mar')).toBe('beira-mar');
  });

  it('remove a pontuação quando há dígitos (CNPJ com máscara)', () => {
    expect(normalizarTermo('12.345.678/0001-95')).toBe('12345678000195');
    expect(normalizarTermo('Padaria 001.')).toBe('padaria 001');
  });

  it('devolve vazio para só espaços', () => {
    expect(normalizarTermo('   ')).toBe('');
  });
});

describe('autenticação e empresa', () => {
  it('exige login', async () => {
    esperarErro(await get('/v1/empresas/aba/clientes', null), 401, 'nao_autenticado');
    esperarErro(await get('/v1/cores', null), 401, 'nao_autenticado');
  });

  it('recusa empresa fora do token', async () => {
    esperarErro(await get('/v1/empresas/roma/clientes'), 403, 'empresa_proibida');
    esperarErro(await get('/v1/empresas/roma/produtos'), 403, 'empresa_proibida');
  });
});

describe('GET /clientes', () => {
  it('pagina em 3 páginas sem repetição nem buraco, com cursor final null', async () => {
    for (let i = 1; i <= 25; i++)
      await criarCliente('aba', `Cliente ${String(i).padStart(2, '0')} Ltda`);

    const primeira = await pagina('?limite=10');
    const segunda = await pagina(`?limite=10&cursor=${primeira.proximoCursor}`);
    const terceira = await pagina(`?limite=10&cursor=${segunda.proximoCursor}`);

    expect(primeira.itens).toHaveLength(10);
    expect(segunda.itens).toHaveLength(10);
    expect(terceira.itens).toHaveLength(5);
    expect(primeira.proximoCursor).not.toBeNull();
    expect(segunda.proximoCursor).not.toBeNull();
    expect(terceira.proximoCursor).toBeNull();

    const nomes = [...primeira.itens, ...segunda.itens, ...terceira.itens].map(
      (c) => c.razaoSocial,
    );
    expect(new Set(nomes).size).toBe(25);
    expect(nomes).toEqual(
      Array.from({ length: 25 }, (_, i) => `Cliente ${String(i + 1).padStart(2, '0')} Ltda`),
    );
  });

  it('usa 20 por página por padrão', async () => {
    for (let i = 1; i <= 21; i++)
      await criarCliente('aba', `Cliente ${String(i).padStart(2, '0')} Ltda`);
    const primeira = await pagina('');
    expect(primeira.itens).toHaveLength(20);
    expect(primeira.proximoCursor).not.toBeNull();
  });

  it('mantém ordem estável com nomes iguais', async () => {
    for (let i = 0; i < 7; i++) await criarCliente('aba', 'Padaria Igual Ltda');

    const ids: string[] = [];
    let cursor = '';
    do {
      const atual = await pagina(`?limite=3${cursor}`);
      ids.push(...atual.itens.map((c) => c.id));
      cursor = atual.proximoCursor ? `&cursor=${atual.proximoCursor}` : '';
    } while (cursor);

    expect(ids).toHaveLength(7);
    expect(new Set(ids).size).toBe(7);
    expect(ids).toEqual([...ids].sort());
  });

  it('ordena sem diferenciar acento nem caixa e usa a fantasia no lugar da razão', async () => {
    await criarCliente('aba', 'Zebra Ltda', 'Álamo Doces');
    await criarCliente('aba', 'beta Ltda');
    await criarCliente('aba', 'Alfa Ltda');

    const { itens } = await pagina('');
    expect(itens.map((c) => c.nomeExibicao)).toEqual(['Álamo Doces', 'Alfa Ltda', 'beta Ltda']);
  });

  it('busca por fantasia, razão, CNPJ com máscara e termo sem acento', async () => {
    const acai = await criarCliente('aba', 'Comércio de Açaí Tropical Ltda', 'Açaí Tropical');
    const pao = await criarCliente('aba', 'Pão Quente Ltda');
    await criarCliente('aba', 'Outro Ltda');

    expect((await pagina('?busca=a%C3%A7a%C3%AD')).itens.map((c) => c.id)).toEqual([acai.id]);
    expect((await pagina('?busca=ACAI%20trop')).itens.map((c) => c.id)).toEqual([acai.id]);
    // Razão social do cliente que tem fantasia também casa.
    expect((await pagina('?busca=com%C3%A9rcio')).itens.map((c) => c.id)).toEqual([acai.id]);
    expect((await pagina('?busca=pao%20quente')).itens.map((c) => c.id)).toEqual([pao.id]);

    const mascara = `${pao.cnpj.slice(0, 2)}.${pao.cnpj.slice(2, 5)}.${pao.cnpj.slice(5, 8)}/${pao.cnpj.slice(8, 12)}-${pao.cnpj.slice(12)}`;
    expect((await pagina(`?busca=${encodeURIComponent(mascara)}`)).itens.map((c) => c.id)).toEqual([
      pao.id,
    ]);
    expect((await pagina(`?busca=${pao.cnpj}`)).itens.map((c) => c.id)).toEqual([pao.id]);
    expect((await pagina(`?busca=${pao.cnpj.slice(0, 8)}`)).itens.map((c) => c.id)).toEqual([
      pao.id,
    ]);
  });

  it('trata % e _ do termo como texto literal', async () => {
    await criarCliente('aba', 'Padaria Exemplo Ltda');
    expect((await pagina('?busca=%25')).itens).toHaveLength(0);
    expect((await pagina('?busca=_')).itens).toHaveLength(0);
  });

  it('pagina também dentro de uma busca', async () => {
    for (let i = 1; i <= 5; i++) await criarCliente('aba', `Padaria ${i} Ltda`);
    await criarCliente('aba', 'Mercado Ltda');

    const primeira = await pagina('?busca=padaria&limite=3');
    const segunda = await pagina(`?busca=padaria&limite=3&cursor=${primeira.proximoCursor}`);
    expect(primeira.itens).toHaveLength(3);
    expect(segunda.itens).toHaveLength(2);
    expect(segunda.proximoCursor).toBeNull();
  });

  it('não mistura empresas', async () => {
    await criarCliente('aba', 'Cliente da Aba Ltda');
    await criarCliente('roma', 'Cliente da Roma Ltda');

    expect((await pagina('')).itens.map((c) => c.razaoSocial)).toEqual(['Cliente da Aba Ltda']);
  });

  it('rejeita limite fora da faixa e cursor malformado', async () => {
    esperarErro(await get('/v1/empresas/aba/clientes?limite=51'), 400, 'requisicao_invalida');
    esperarErro(await get('/v1/empresas/aba/clientes?limite=0'), 400, 'requisicao_invalida');
    esperarErro(await get('/v1/empresas/aba/clientes?cursor=lixo'), 400, 'requisicao_invalida');
  });
});

describe('GET /clientes/:id', () => {
  it('devolve o cliente da empresa', async () => {
    const criado = await criarCliente('aba', 'Padaria Exemplo Ltda', 'Padaria Exemplo');
    const resposta = await get(`/v1/empresas/aba/clientes/${criado.id}`);
    expect(resposta.statusCode).toBe(200);
    const cliente: Cliente = EsquemaCliente.parse(resposta.json());
    expect(cliente).toEqual({
      id: criado.id,
      nomeExibicao: 'Padaria Exemplo',
      razaoSocial: 'Padaria Exemplo Ltda',
      nomeFantasia: 'Padaria Exemplo',
      cnpj: criado.cnpj,
    });
  });

  it('responde 404 para cliente de outra empresa, inexistente ou id malformado', async () => {
    const dois = await entrar('bia@exemplo.com', ['aba', 'roma']);
    const daRoma = await criarCliente('roma', 'Cliente da Roma Ltda');

    esperarErro(
      await get(`/v1/empresas/aba/clientes/${daRoma.id}`, dois),
      404,
      'cliente_nao_encontrado',
    );
    esperarErro(
      await get(`/v1/empresas/aba/clientes/${crypto.randomUUID()}`),
      404,
      'cliente_nao_encontrado',
    );
    esperarErro(await get('/v1/empresas/aba/clientes/nao-e-uuid'), 404, 'cliente_nao_encontrado');
    expect((await get(`/v1/empresas/roma/clientes/${daRoma.id}`, dois)).statusCode).toBe(200);
  });
});

describe('GET /clientes/:id/produtos', () => {
  it('lista só produtos com arte, com o código e a quantidade', async () => {
    const cliente = await criarCliente('aba', 'Padaria Exemplo Ltda');
    const outro = await criarCliente('aba', 'Mercado Exemplo Ltda');
    const pizza = await criarProduto('aba', 'Caixa de Pizza', 'CX0001');
    const sacola = await criarProduto('aba', 'Sacola de Papel');
    await criarProduto('aba', 'Copo de Papel');

    await criarArte('aba', cliente.id, pizza.id, 'Padrão');
    await criarArte('aba', cliente.id, pizza.id, 'Natal');
    await criarArte('aba', cliente.id, sacola.id, 'Padrão');
    await criarArte('aba', outro.id, sacola.id, 'Padrão');

    const resposta = await get(`/v1/empresas/aba/clientes/${cliente.id}/produtos`);
    expect(resposta.statusCode).toBe(200);
    expect(z.array(EsquemaProdutoDoCliente).parse(resposta.json())).toEqual([
      { id: pizza.id, nome: 'Caixa de Pizza', codigo: 'CX0001', quantidadeArtes: 2 },
      { id: sacola.id, nome: 'Sacola de Papel', codigo: null, quantidadeArtes: 1 },
    ]);
  });

  it('devolve lista vazia para cliente sem artes e 404 para cliente de outra empresa', async () => {
    const semArtes = await criarCliente('aba', 'Padaria Exemplo Ltda');
    const daRoma = await criarCliente('roma', 'Cliente da Roma Ltda');

    const vazio = await get(`/v1/empresas/aba/clientes/${semArtes.id}/produtos`);
    expect(vazio.statusCode).toBe(200);
    expect(vazio.json()).toEqual([]);
    esperarErro(
      await get(`/v1/empresas/aba/clientes/${daRoma.id}/produtos`),
      404,
      'cliente_nao_encontrado',
    );
  });
});

describe('opções', () => {
  it('GET /produtos devolve só os produtos da empresa, em ordem alfabética', async () => {
    await criarProduto('aba', 'Sacola de Papel');
    await criarProduto('aba', 'Álbum de Fotos');
    await criarProduto('roma', 'Produto da Roma');

    const resposta = await get('/v1/empresas/aba/produtos');
    expect(resposta.statusCode).toBe(200);
    const lista = z.array(EsquemaOpcao).parse(resposta.json());
    expect(lista.map((p) => p.nome)).toEqual(['Álbum de Fotos', 'Sacola de Papel']);
  });

  it('GET /cores e /maquinas devolvem os valores das migrações', async () => {
    const coresResposta = await get('/v1/cores');
    const maquinasResposta = await get('/v1/maquinas');
    expect(
      z
        .array(EsquemaOpcao)
        .parse(coresResposta.json())
        .map((c) => c.nome),
    ).toEqual(['4x0', '4x4']);
    expect(
      z
        .array(EsquemaOpcao)
        .parse(maquinasResposta.json())
        .map((m) => m.nome),
    ).toEqual(['Favorit', 'Rekord', 'Ultra']);
  });
});

type OpcoesArte = {
  nome: string;
  cor?: string;
  maquinas?: string[];
  imagem?: boolean;
  pdf?: boolean;
  criadoEm?: Date;
};

// Arte com cor e máquinas pelo nome (valores das migrações), PDF e/ou PNG de teste.
async function inserirArte(slug: string, clienteId: string, produtoId: string, o: OpcoesArte) {
  const [cor] = await db
    .select()
    .from(cores)
    .where(eq(cores.nome, o.cor ?? '4x0'));
  const maquinasEscolhidas = await db
    .select()
    .from(maquinas)
    .where(inArray(maquinas.nome, o.maquinas ?? ['Favorit']));
  if (!cor || maquinasEscolhidas.length === 0) throw new Error('referências ausentes');

  const gravar = async (nomeOriginal: string, tipoMime: string, conteudo: Buffer) => {
    const [arquivo] = await db
      .insert(arquivos)
      .values({
        nomeOriginal,
        tipoMime,
        tamanho: conteudo.length,
        sha256: createHash('sha256').update(conteudo).digest('hex'),
        conteudo,
      })
      .returning();
    if (!arquivo) throw new Error('arquivo não criado');
    return arquivo.id;
  };
  const pdfId = o.pdf === false ? null : await gravar('arte.pdf', 'application/pdf', PDF_MINIMO);
  const imagemId = o.imagem ? await gravar('arte.png', 'image/png', PNG_1X1) : null;

  const [arte] = await db
    .insert(artes)
    .values({
      empresaId: await empresaId(slug),
      clienteId,
      produtoId,
      nome: o.nome,
      corId: cor.id,
      pdfId,
      imagemId,
      ...(o.criadoEm && { criadoEm: o.criadoEm }),
    })
    .returning();
  if (!arte) throw new Error('arte não criada');
  await db
    .insert(arteMaquinas)
    .values(maquinasEscolhidas.map((m) => ({ arteId: arte.id, maquinaId: m.id })));
  return arte;
}

const INEXISTENTE = '00000000-0000-4000-8000-000000000000';

describe('GET /clientes/:id/produtos/:produtoId/artes', () => {
  const rota = (clienteId: string, produtoId: string, empresa = 'aba') =>
    `/v1/empresas/${empresa}/clientes/${clienteId}/produtos/${produtoId}/artes`;
  const listar = async (clienteId: string, produtoId: string) =>
    z.array(EsquemaArteDoProduto).parse((await get(rota(clienteId, produtoId))).json());

  it('lista as artes do produto da mais nova para a mais antiga, com cor, máquinas e arquivos', async () => {
    const cliente = await criarCliente('aba', 'Padaria Exemplo Ltda');
    const pizza = await criarProduto('aba', 'Caixa de Pizza');
    const antiga = await inserirArte('aba', cliente.id, pizza.id, {
      nome: 'Antiga',
      criadoEm: new Date('2026-01-10T12:00:00Z'),
    });
    const recente = await inserirArte('aba', cliente.id, pizza.id, {
      nome: 'Recente',
      cor: '4x4',
      maquinas: ['Rekord', 'Favorit'],
      imagem: true,
      pdf: false,
      criadoEm: new Date('2026-03-05T12:00:00Z'),
    });

    const resposta = await get(rota(cliente.id, pizza.id));
    expect(resposta.statusCode).toBe(200);
    const lista = z.array(EsquemaArteDoProduto).parse(resposta.json());
    expect(lista.map((a) => a.id)).toEqual([recente.id, antiga.id]);
    expect(lista[0]).toMatchObject({
      nome: 'Recente',
      cor: { nome: '4x4' },
      criadoEm: '2026-03-05T12:00:00.000Z',
      temPdf: false,
      temImagem: true,
    });
    expect(lista[0]?.maquinas.map((m) => m.nome)).toEqual(['Favorit', 'Rekord']);
    expect(lista[1]).toMatchObject({ cor: { nome: '4x0' }, temPdf: true, temImagem: false });
    expect(lista[1]?.maquinas.map((m) => m.nome)).toEqual(['Favorit']);
  });

  it('mantém a mesma ordem para artes criadas no mesmo instante', async () => {
    const cliente = await criarCliente('aba', 'Padaria Exemplo Ltda');
    const pizza = await criarProduto('aba', 'Caixa de Pizza');
    const instante = new Date('2026-02-01T10:00:00Z');
    await inserirArte('aba', cliente.id, pizza.id, { nome: 'A', criadoEm: instante });
    await inserirArte('aba', cliente.id, pizza.id, { nome: 'B', criadoEm: instante });

    const primeira = await listar(cliente.id, pizza.id);
    const segunda = await listar(cliente.id, pizza.id);
    expect(primeira).toHaveLength(2);
    expect(primeira.map((a) => a.id)).toEqual(segunda.map((a) => a.id));
  });

  it('não mistura artes de outro produto nem de outro cliente', async () => {
    const cliente = await criarCliente('aba', 'Padaria Exemplo Ltda');
    const outro = await criarCliente('aba', 'Mercado Exemplo Ltda');
    const pizza = await criarProduto('aba', 'Caixa de Pizza');
    const sacola = await criarProduto('aba', 'Sacola de Papel');
    await inserirArte('aba', cliente.id, pizza.id, { nome: 'Da pizza' });
    await inserirArte('aba', cliente.id, sacola.id, { nome: 'Da sacola' });
    await inserirArte('aba', outro.id, pizza.id, { nome: 'Do outro cliente' });

    expect((await listar(cliente.id, pizza.id)).map((a) => a.nome)).toEqual(['Da pizza']);
  });

  it('devolve lista vazia para produto sem arte do cliente', async () => {
    const cliente = await criarCliente('aba', 'Padaria Exemplo Ltda');
    const produto = await criarProduto('aba', 'Copo de Papel');
    const resposta = await get(rota(cliente.id, produto.id));
    expect(resposta.statusCode).toBe(200);
    expect(resposta.json()).toEqual([]);
  });

  it('responde 404 para cliente ou produto de outra empresa, inexistente ou com id malformado', async () => {
    const cliente = await criarCliente('aba', 'Padaria Exemplo Ltda');
    const produto = await criarProduto('aba', 'Caixa de Pizza');
    const clienteDaRoma = await criarCliente('roma', 'Cliente da Roma Ltda');
    const produtoDaRoma = await criarProduto('roma', 'Produto da Roma');

    esperarErro(await get(rota(clienteDaRoma.id, produto.id)), 404, 'cliente_nao_encontrado');
    esperarErro(await get(rota(cliente.id, produtoDaRoma.id)), 404, 'produto_nao_encontrado');
    esperarErro(await get(rota(cliente.id, INEXISTENTE)), 404, 'produto_nao_encontrado');
    esperarErro(await get(rota(cliente.id, 'nao-e-uuid')), 404, 'produto_nao_encontrado');
    esperarErro(await get(rota('nao-e-uuid', produto.id)), 404, 'cliente_nao_encontrado');
  });

  it('exige login e empresa do token', async () => {
    const cliente = await criarCliente('roma', 'Cliente da Roma Ltda');
    const produto = await criarProduto('roma', 'Produto da Roma');
    esperarErro(await get(rota(cliente.id, produto.id, 'roma'), null), 401, 'nao_autenticado');
    esperarErro(await get(rota(cliente.id, produto.id, 'roma')), 403, 'empresa_proibida');
  });
});

describe('GET /artes/:id/imagem', () => {
  it('devolve os bytes da imagem com o tipo e cabeçalhos de segurança', async () => {
    const cliente = await criarCliente('aba', 'Padaria Exemplo Ltda');
    const produto = await criarProduto('aba', 'Caixa de Pizza');
    const arte = await inserirArte('aba', cliente.id, produto.id, {
      nome: 'Com imagem',
      imagem: true,
    });

    const resposta = await get(`/v1/empresas/aba/artes/${arte.id}/imagem`);
    expect(resposta.statusCode).toBe(200);
    expect(resposta.headers['content-type']).toBe('image/png');
    expect(resposta.headers['x-content-type-options']).toBe('nosniff');
    expect(resposta.headers['cache-control']).toBe('private, no-cache');
    expect(resposta.rawPayload.equals(PNG_1X1)).toBe(true);
  });

  it('responde 404 para arte sem imagem, de outra empresa, inexistente ou com id malformado', async () => {
    const cliente = await criarCliente('aba', 'Padaria Exemplo Ltda');
    const produto = await criarProduto('aba', 'Caixa de Pizza');
    const soPdf = await inserirArte('aba', cliente.id, produto.id, { nome: 'Só PDF' });
    const clienteDaRoma = await criarCliente('roma', 'Cliente da Roma Ltda');
    const produtoDaRoma = await criarProduto('roma', 'Produto da Roma');
    const daRoma = await inserirArte('roma', clienteDaRoma.id, produtoDaRoma.id, {
      nome: 'Da Roma',
      imagem: true,
    });

    for (const id of [soPdf.id, daRoma.id, INEXISTENTE, 'nao-e-uuid']) {
      esperarErro(await get(`/v1/empresas/aba/artes/${id}/imagem`), 404, 'imagem_nao_encontrada');
    }
  });

  it('exige login e empresa do token', async () => {
    esperarErro(
      await get(`/v1/empresas/aba/artes/${INEXISTENTE}/imagem`, null),
      401,
      'nao_autenticado',
    );
    esperarErro(
      await get(`/v1/empresas/roma/artes/${INEXISTENTE}/imagem`),
      403,
      'empresa_proibida',
    );
  });
});

describe('inativos no Bling', () => {
  it('somem da listagem, da busca e das opções, mas o cliente e as artes continuam acessíveis', async () => {
    const ativo = await criarCliente('aba', 'Padaria Ativa Ltda');
    const inativo = await criarCliente('aba', 'Padaria Inativa Ltda');
    const produtoAtivo = await criarProduto('aba', 'Caixa de Pizza');
    const produtoInativo = await criarProduto('aba', 'Sacola de Papel', 'SC0001');
    await criarArte('aba', inativo.id, produtoInativo.id, 'Padrão');

    const marca = new Date();
    await db
      .update(clientes)
      .set({ idBling: 101, inativoNoBlingEm: marca })
      .where(eq(clientes.id, inativo.id));
    await db
      .update(produtos)
      .set({ idBling: 202, inativoNoBlingEm: marca })
      .where(eq(produtos.id, produtoInativo.id));

    expect((await pagina('')).itens.map((c) => c.id)).toEqual([ativo.id]);
    expect((await pagina('?busca=padaria')).itens.map((c) => c.id)).toEqual([ativo.id]);
    expect((await pagina(`?busca=${inativo.cnpj}`)).itens).toEqual([]);

    const opcoes = z.array(EsquemaOpcao).parse((await get('/v1/empresas/aba/produtos')).json());
    expect(opcoes.map((p) => p.id)).toEqual([produtoAtivo.id]);

    const doCliente = await get(`/v1/empresas/aba/clientes/${inativo.id}`);
    expect(doCliente.statusCode).toBe(200);
    expect(EsquemaCliente.parse(doCliente.json()).id).toBe(inativo.id);

    const produtosDoInativo = await get(`/v1/empresas/aba/clientes/${inativo.id}/produtos`);
    expect(z.array(EsquemaProdutoDoCliente).parse(produtosDoInativo.json())).toEqual([
      { id: produtoInativo.id, nome: 'Sacola de Papel', codigo: 'SC0001', quantidadeArtes: 1 },
    ]);
    const artesDoInativo = await get(
      `/v1/empresas/aba/clientes/${inativo.id}/produtos/${produtoInativo.id}/artes`,
    );
    expect(artesDoInativo.statusCode).toBe(200);
    expect(z.array(EsquemaArteDoProduto).parse(artesDoInativo.json())).toHaveLength(1);
  });

  it('voltam a aparecer quando a marca sai', async () => {
    const cliente = await criarCliente('aba', 'Padaria Exemplo Ltda');
    await db
      .update(clientes)
      .set({ inativoNoBlingEm: new Date() })
      .where(eq(clientes.id, cliente.id));
    expect((await pagina('')).itens).toEqual([]);

    await db.update(clientes).set({ inativoNoBlingEm: null }).where(eq(clientes.id, cliente.id));
    expect((await pagina('')).itens.map((c) => c.id)).toEqual([cliente.id]);
  });
});
