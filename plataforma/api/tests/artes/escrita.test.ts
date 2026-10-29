import { createHash } from 'node:crypto';

import {
  EsquemaArte,
  EsquemaErro,
  EsquemaRespostaEntrar,
  LIMITES,
  type Perfil,
} from '@plataforma/contratos';
import { eq } from 'drizzle-orm';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { gerarCnpj, PDF_MINIMO, PNG_1X1 } from '../../src/cli/semear-dev.js';
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

const { db, fechar } = criarBancoTeste();
afterAll(() => fechar());

const SENHA = 'senha-ficticia-123';
const FRONTEIRA = '----fronteira-de-teste';

type Parte =
  { nome: string; valor: string } | { nome: string; arquivo: Buffer; nomeArquivo: string };

// Monta o corpo multipart na mão, para o teste não depender de nenhuma biblioteca de envio.
function multipart(partes: Parte[]) {
  const blocos: Buffer[] = [];
  for (const parte of partes) {
    const cabecalho =
      'arquivo' in parte
        ? `Content-Disposition: form-data; name="${parte.nome}"; filename="${parte.nomeArquivo}"\r\nContent-Type: application/octet-stream`
        : `Content-Disposition: form-data; name="${parte.nome}"`;
    blocos.push(Buffer.from(`--${FRONTEIRA}\r\n${cabecalho}\r\n\r\n`));
    blocos.push('arquivo' in parte ? parte.arquivo : Buffer.from(parte.valor));
    blocos.push(Buffer.from('\r\n'));
  }
  blocos.push(Buffer.from(`--${FRONTEIRA}--\r\n`));
  return {
    payload: Buffer.concat(blocos),
    headers: { 'content-type': `multipart/form-data; boundary=${FRONTEIRA}` },
  };
}

const pdf = (tamanho = PDF_MINIMO.length) =>
  Buffer.concat([PDF_MINIMO, Buffer.alloc(Math.max(0, tamanho - PDF_MINIMO.length))]);

let app: FastifyInstance;
let tokenFinalista: string;
let tokenAdmin: string;
let clienteId: string;
let produtoId: string;
let corId: string;
let maquinaIds: string[];

async function entrar(email: string, perfil: Perfil, empresasDoUsuario: string[]) {
  await criarUsuario(db, {
    email,
    nome: 'Usuária Teste',
    perfil,
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

async function empresaId(slug: string) {
  const [linha] = await db.select().from(empresas).where(eq(empresas.slug, slug));
  if (!linha) throw new Error(`empresa ${slug} não semeada`);
  return linha.id;
}

let contadorCnpj = 100;
async function criarCliente(slug: string) {
  const [cliente] = await db
    .insert(clientes)
    .values({
      empresaId: await empresaId(slug),
      razaoSocial: 'Cliente Fictício Ltda',
      cnpj: gerarCnpj(++contadorCnpj),
    })
    .returning();
  if (!cliente) throw new Error('cliente não criado');
  return cliente.id;
}

async function criarProduto(slug: string, nome: string) {
  const [produto] = await db
    .insert(produtos)
    .values({ empresaId: await empresaId(slug), nome })
    .returning();
  if (!produto) throw new Error('produto não criado');
  return produto.id;
}

beforeEach(async () => {
  await limparTabelas(db);
  ({ app } = criarAppTeste(db));
  tokenFinalista = await entrar('ana@exemplo.com', 'arte_finalista', ['aba']);
  tokenAdmin = await entrar('adm@exemplo.com', 'admin', ['aba']);
  clienteId = await criarCliente('aba');
  produtoId = await criarProduto('aba', 'Cartão de visita');
  corId = (await db.select().from(cores).limit(1))[0]?.id ?? '';
  maquinaIds = (await db.select().from(maquinas)).map((m) => m.id);
});
afterEach(() => app.close());

function enviar(
  metodo: 'POST' | 'PATCH',
  url: string,
  partes: Parte[],
  token: string | null = tokenFinalista,
) {
  const { payload, headers } = multipart(partes);
  return app.inject({
    method: metodo,
    url,
    payload,
    headers: { ...headers, ...(token ? { authorization: `Bearer ${token}` } : {}) },
  });
}

const urlCadastro = (id = clienteId, empresa = 'aba') =>
  `/v1/empresas/${empresa}/clientes/${id}/artes`;
const urlArte = (id: string, empresa = 'aba') => `/v1/empresas/${empresa}/artes/${id}`;

const camposBase = (): Parte[] => [
  { nome: 'produtoId', valor: produtoId },
  { nome: 'corId', valor: corId },
  { nome: 'maquinaIds', valor: maquinaIds[0] ?? '' },
];
const parteArquivo = (nome: 'pdf' | 'imagem', conteudo: Buffer, nomeArquivo?: string): Parte => ({
  nome,
  arquivo: conteudo,
  nomeArquivo: nomeArquivo ?? (nome === 'pdf' ? 'arte.pdf' : 'arte.png'),
});

function esperarErro(resposta: LightMyRequestResponse, status: number, codigo: string) {
  expect(resposta.statusCode).toBe(status);
  expect(EsquemaErro.parse(resposta.json()).erro.codigo).toBe(codigo);
}

async function cadastrar(partes: Parte[] = [...camposBase(), parteArquivo('pdf', pdf())]) {
  const resposta = await enviar('POST', urlCadastro(), partes);
  expect(resposta.statusCode).toBe(201);
  return EsquemaArte.parse(resposta.json());
}

const del = (id: string, token: string | null = tokenAdmin) =>
  app.inject({
    method: 'DELETE',
    url: urlArte(id),
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });

describe('POST /clientes/:id/artes', () => {
  it('cadastra só com PDF, e o nome vazio vira "Padrão"', async () => {
    const arte = await cadastrar();
    expect(arte.nome).toBe('Padrão');
    expect(arte.pdf).toMatchObject({ tipoMime: 'application/pdf', nomeOriginal: 'arte.pdf' });
    expect(arte.imagem).toBeNull();
    expect(arte.maquinaIds).toEqual([maquinaIds[0]]);

    const [arquivo] = await db.select().from(arquivos);
    expect(arquivo?.sha256).toBe(createHash('sha256').update(pdf()).digest('hex'));
    const [gravada] = await db.select().from(artes);
    expect(gravada?.criadoPor).not.toBeNull();
    expect(gravada?.atualizadoPor).toBe(gravada?.criadoPor);
  });

  it('cadastra só com imagem', async () => {
    const arte = await cadastrar([
      ...camposBase(),
      { nome: 'nome', valor: 'Frente' },
      parteArquivo('imagem', PNG_1X1),
    ]);
    expect(arte.nome).toBe('Frente');
    expect(arte.pdf).toBeNull();
    expect(arte.imagem?.tipoMime).toBe('image/png');
  });

  it('cadastra com PDF, imagem e as duas máquinas', async () => {
    const arte = await cadastrar([
      { nome: 'produtoId', valor: produtoId },
      { nome: 'corId', valor: corId },
      ...maquinaIds.map((valor) => ({ nome: 'maquinaIds', valor })),
      parteArquivo('pdf', pdf()),
      parteArquivo('imagem', PNG_1X1),
    ]);
    expect(arte.pdf).not.toBeNull();
    expect(arte.imagem).not.toBeNull();
    expect([...arte.maquinaIds].sort()).toEqual([...maquinaIds].sort());
    expect(await db.select().from(arteMaquinas)).toHaveLength(maquinaIds.length);
    expect(await db.select().from(arquivos)).toHaveLength(2);
  });

  it('aceita um PDF de exatamente 25 MB', async () => {
    await cadastrar([...camposBase(), parteArquivo('pdf', pdf(LIMITES.pdfBytes))]);
  });

  it('recusa PDF de 25 MB + 1 byte com 413 e não grava nada', async () => {
    const resposta = await enviar('POST', urlCadastro(), [
      ...camposBase(),
      parteArquivo('pdf', pdf(LIMITES.pdfBytes + 1)),
    ]);
    esperarErro(resposta, 413, 'arquivo_grande');
    expect(await db.select().from(arquivos)).toHaveLength(0);
  });

  it('recusa imagem acima de 10 MB com 413', async () => {
    const grande = Buffer.concat([PNG_1X1, Buffer.alloc(LIMITES.imagemBytes)]);
    esperarErro(
      await enviar('POST', urlCadastro(), [...camposBase(), parteArquivo('imagem', grande)]),
      413,
      'arquivo_grande',
    );
  });

  it('recusa arquivo de extensão trocada com 415', async () => {
    // Texto com extensão .pdf; e PDF enviado no campo de imagem.
    esperarErro(
      await enviar('POST', urlCadastro(), [
        ...camposBase(),
        parteArquivo('pdf', Buffer.from('não sou um pdf'), 'falso.pdf'),
      ]),
      415,
      'tipo_nao_suportado',
    );
    esperarErro(
      await enviar('POST', urlCadastro(), [
        ...camposBase(),
        parteArquivo('imagem', pdf(), 'falso.png'),
      ]),
      415,
      'tipo_nao_suportado',
    );
  });

  it('recusa com 422: sem arquivo, sem máquina, cor ou produto inexistente', async () => {
    esperarErro(await enviar('POST', urlCadastro(), camposBase()), 422, 'validacao');
    esperarErro(
      await enviar('POST', urlCadastro(), [
        { nome: 'produtoId', valor: produtoId },
        { nome: 'corId', valor: corId },
        parteArquivo('pdf', pdf()),
      ]),
      422,
      'validacao',
    );
    const inexistente = '00000000-0000-4000-8000-000000000000';
    esperarErro(
      await enviar('POST', urlCadastro(), [
        { nome: 'produtoId', valor: produtoId },
        { nome: 'corId', valor: inexistente },
        { nome: 'maquinaIds', valor: maquinaIds[0] ?? '' },
        parteArquivo('pdf', pdf()),
      ]),
      422,
      'validacao',
    );
    expect(await db.select().from(artes)).toHaveLength(0);
  });

  it('recusa produto de outra empresa com 422', async () => {
    const deOutra = await criarProduto('roma', 'Produto da outra empresa');
    const resposta = await enviar('POST', urlCadastro(), [
      { nome: 'produtoId', valor: deOutra },
      { nome: 'corId', valor: corId },
      { nome: 'maquinaIds', valor: maquinaIds[0] ?? '' },
      parteArquivo('pdf', pdf()),
    ]);
    esperarErro(resposta, 422, 'validacao');
    expect(await db.select().from(arquivos)).toHaveLength(0);
  });

  it('recusa nome repetido (sem diferenciar caixa e acento) com 409', async () => {
    await cadastrar([
      ...camposBase(),
      { nome: 'nome', valor: 'Padrão' },
      parteArquivo('pdf', pdf()),
    ]);
    const resposta = await enviar('POST', urlCadastro(), [
      ...camposBase(),
      { nome: 'nome', valor: 'padrao' },
      parteArquivo('pdf', pdf()),
    ]);
    esperarErro(resposta, 409, 'arte_duplicada');
    expect(resposta.json().erro.mensagem).toBe("Já existe uma arte 'padrao' para este produto");
    // A transação desfez os arquivos do segundo envio.
    expect(await db.select().from(arquivos)).toHaveLength(1);
  });

  it('exige login e acesso à empresa; cliente de outra empresa dá 404', async () => {
    esperarErro(await enviar('POST', urlCadastro(), camposBase(), null), 401, 'nao_autenticado');
    esperarErro(
      await enviar('POST', urlCadastro(clienteId, 'roma'), camposBase()),
      403,
      'empresa_proibida',
    );
    const deOutra = await criarCliente('roma');
    esperarErro(
      await enviar('POST', urlCadastro(deOutra), camposBase()),
      404,
      'cliente_nao_encontrado',
    );
    esperarErro(
      await enviar('POST', urlCadastro('nao-e-uuid'), camposBase()),
      404,
      'cliente_nao_encontrado',
    );
  });
});

describe('PATCH /artes/:id', () => {
  it('admin troca nome, cor, máquinas e arquivos mantendo ao menos um', async () => {
    const arte = await cadastrar();
    const outraCor = (await db.select().from(cores)).find((c) => c.id !== corId);

    const resposta = await enviar(
      'PATCH',
      urlArte(arte.id),
      [
        { nome: 'nome', valor: 'Verso' },
        { nome: 'corId', valor: outraCor?.id ?? '' },
        ...maquinaIds.map((valor) => ({ nome: 'maquinaIds', valor })),
        parteArquivo('imagem', PNG_1X1),
        { nome: 'removerPdf', valor: 'true' },
      ],
      tokenAdmin,
    );
    expect(resposta.statusCode).toBe(200);
    const editada = EsquemaArte.parse(resposta.json());
    expect(editada).toMatchObject({ nome: 'Verso', corId: outraCor?.id, pdf: null });
    expect(editada.imagem).not.toBeNull();
    expect(editada.maquinaIds).toHaveLength(maquinaIds.length);
    // O PDF antigo foi apagado; sobra só a imagem.
    expect(await db.select().from(arquivos)).toHaveLength(1);
  });

  it('substitui um arquivo apagando o antigo', async () => {
    const arte = await cadastrar();
    const novo = Buffer.concat([pdf(), Buffer.from('\n% revisão')]);
    const resposta = await enviar(
      'PATCH',
      urlArte(arte.id),
      [parteArquivo('pdf', novo, 'v2.pdf')],
      tokenAdmin,
    );
    expect(resposta.statusCode).toBe(200);
    const linhas = await db.select().from(arquivos);
    expect(linhas).toHaveLength(1);
    expect(linhas[0]?.nomeOriginal).toBe('v2.pdf');
  });

  it('recusa deixar a arte sem arquivo com 422 e preserva o que existia', async () => {
    const arte = await cadastrar();
    esperarErro(
      await enviar('PATCH', urlArte(arte.id), [{ nome: 'removerPdf', valor: 'true' }], tokenAdmin),
      422,
      'validacao',
    );
    expect(await db.select().from(arquivos)).toHaveLength(1);
  });

  it('recusa renomear para um nome já usado com 409', async () => {
    await cadastrar([
      ...camposBase(),
      { nome: 'nome', valor: 'Frente' },
      parteArquivo('pdf', pdf()),
    ]);
    const verso = await cadastrar([
      ...camposBase(),
      { nome: 'nome', valor: 'Verso' },
      parteArquivo('pdf', pdf()),
    ]);
    esperarErro(
      await enviar('PATCH', urlArte(verso.id), [{ nome: 'nome', valor: 'FRENTE' }], tokenAdmin),
      409,
      'arte_duplicada',
    );
  });

  it('arte finalista recebe 403; arte de outra empresa ou inexistente, 404', async () => {
    const arte = await cadastrar();
    esperarErro(
      await enviar('PATCH', urlArte(arte.id), [{ nome: 'nome', valor: 'X' }]),
      403,
      'perfil_proibido',
    );
    esperarErro(
      await enviar('PATCH', urlArte('00000000-0000-4000-8000-000000000000'), [], tokenAdmin),
      404,
      'arte_nao_encontrada',
    );
    esperarErro(await enviar('PATCH', urlArte('x'), [], tokenAdmin), 404, 'arte_nao_encontrada');
  });
});

describe('DELETE /artes/:id', () => {
  it('admin remove a arte, as máquinas e os arquivos', async () => {
    const arte = await cadastrar([
      ...camposBase(),
      parteArquivo('pdf', pdf()),
      parteArquivo('imagem', PNG_1X1),
    ]);
    expect((await del(arte.id)).statusCode).toBe(204);
    expect(await db.select().from(artes)).toHaveLength(0);
    expect(await db.select().from(arteMaquinas)).toHaveLength(0);
    expect(await db.select().from(arquivos)).toHaveLength(0);
    esperarErro(await del(arte.id), 404, 'arte_nao_encontrada');
  });

  it('arte finalista recebe 403 e nada é removido', async () => {
    const arte = await cadastrar();
    esperarErro(await del(arte.id, tokenFinalista), 403, 'perfil_proibido');
    esperarErro(await del(arte.id, null), 401, 'nao_autenticado');
    expect(await db.select().from(artes)).toHaveLength(1);
    expect(await db.select().from(arquivos)).toHaveLength(1);
  });
});
