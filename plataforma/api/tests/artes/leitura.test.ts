import {
  EsquemaCliente,
  EsquemaErro,
  EsquemaOpcao,
  EsquemaPaginaClientes,
  EsquemaProdutoDoCliente,
  EsquemaRespostaEntrar,
  type Cliente,
  type PaginaClientes,
} from '@plataforma/contratos';
import { eq } from 'drizzle-orm';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { gerarCnpj, PDF_MINIMO } from '../../src/cli/semear-dev.js';
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

async function criarProduto(slug: string, nome: string) {
  const [produto] = await db
    .insert(produtos)
    .values({ empresaId: await empresaId(slug), nome })
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
  it('lista só produtos com arte, com a quantidade', async () => {
    const cliente = await criarCliente('aba', 'Padaria Exemplo Ltda');
    const outro = await criarCliente('aba', 'Mercado Exemplo Ltda');
    const pizza = await criarProduto('aba', 'Caixa de Pizza');
    const sacola = await criarProduto('aba', 'Sacola de Papel');
    await criarProduto('aba', 'Copo de Papel');

    await criarArte('aba', cliente.id, pizza.id, 'Padrão');
    await criarArte('aba', cliente.id, pizza.id, 'Natal');
    await criarArte('aba', cliente.id, sacola.id, 'Padrão');
    await criarArte('aba', outro.id, sacola.id, 'Padrão');

    const resposta = await get(`/v1/empresas/aba/clientes/${cliente.id}/produtos`);
    expect(resposta.statusCode).toBe(200);
    expect(z.array(EsquemaProdutoDoCliente).parse(resposta.json())).toEqual([
      { id: pizza.id, nome: 'Caixa de Pizza', quantidadeArtes: 2 },
      { id: sacola.id, nome: 'Sacola de Papel', quantidadeArtes: 1 },
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
    ).toEqual(['Favorit', 'Rekord']);
  });
});
