import {
  EsquemaArteDoProduto,
  EsquemaComentarioTarefa,
  EsquemaContagemTarefas,
  EsquemaErro,
  EsquemaEventoTarefa,
  EsquemaRespostaEntrar,
  EsquemaTarefa,
  EsquemaTarefaDetalhe,
  type Perfil,
  type StatusTarefa,
} from '@plataforma/contratos';
import { eq } from 'drizzle-orm';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { gerarCnpj, PDF_MINIMO, PNG_1X1 } from '../../src/cli/semear-dev.js';
import {
  clientes,
  cores,
  empresas,
  maquinas,
  produtos,
  tarefasArte,
  usuarios,
} from '../../src/db/esquema.js';
import { criarUsuario } from '../../src/usuarios/servico.js';
import { criarAppTeste } from '../helpers/app.js';
import { criarBancoTeste, limparTabelas } from '../helpers/banco.js';
import { chavesNoBucket, criarArmazemTeste, limparBucket } from '../helpers/s3.js';

// Dados sintéticos.
const { db, fechar } = criarBancoTeste();
afterAll(() => fechar());

const SENHA = 'senha-ficticia-123';
const FRONTEIRA = '----fronteira-de-teste';

let app: FastifyInstance;
let tokenAna: string;
let tokenBia: string;
let tokenAdmin: string;
let clienteId: string;
let produtoId: string;
let corId: string;
let maquinaId: string;

async function entrar(email: string, nome: string, perfil: Perfil) {
  await criarUsuario(db, { email, nome, perfil, senha: SENHA, empresas: ['aba'] });
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

beforeEach(async () => {
  await limparTabelas(db);
  ({ app } = criarAppTeste(db));
  tokenAna = await entrar('ana@exemplo.com', 'Ana Ficticia', 'arte_finalista');
  tokenBia = await entrar('bia@exemplo.com', 'Bia Ficticia', 'arte_finalista');
  tokenAdmin = await entrar('adm@exemplo.com', 'Admin Ficticio', 'admin');
  const aba = await empresaId('aba');
  const [cliente] = await db
    .insert(clientes)
    .values({
      empresaId: aba,
      razaoSocial: 'Pizzaria Ficticia Ltda',
      nomeFantasia: 'Pizzaria Ficticia',
      cnpj: gerarCnpj(7),
    })
    .returning();
  const [produto] = await db
    .insert(produtos)
    .values({ empresaId: aba, nome: 'Caixa de pizza 35x35' })
    .returning();
  clienteId = cliente!.id;
  produtoId = produto!.id;
  corId = (await db.select().from(cores).limit(1))[0]!.id;
  maquinaId = (await db.select().from(maquinas).limit(1))[0]!.id;
});
afterEach(() => app.close());

const auth = (token: string | null) => (token ? { authorization: `Bearer ${token}` } : {});

const urlCriar = (cliente = clienteId, produto = produtoId) =>
  `/v1/empresas/aba/clientes/${cliente}/produtos/${produto}/tarefas`;
const urlTarefa = (id: string, sufixo = '') => `/v1/empresas/aba/tarefas/${id}${sufixo}`;

function esperarErro(resposta: LightMyRequestResponse, status: number, codigo: string) {
  expect(resposta.statusCode).toBe(status);
  expect(EsquemaErro.parse(resposta.json()).erro.codigo).toBe(codigo);
}

async function criar(token = tokenAna) {
  const resposta = await app.inject({ method: 'POST', url: urlCriar(), headers: auth(token) });
  expect(resposta.statusCode).toBe(201);
  return EsquemaTarefa.parse(resposta.json());
}

const mudar = (id: string, status: StatusTarefa | string, token = tokenAna) =>
  app.inject({
    method: 'PATCH',
    url: urlTarefa(id, '/status'),
    headers: auth(token),
    payload: { status },
  });

const listar = (token: string, consulta = '') =>
  app.inject({ method: 'GET', url: `/v1/empresas/aba/tarefas${consulta}`, headers: auth(token) });

async function historico(id: string, token = tokenAna) {
  const resposta = await app.inject({
    method: 'GET',
    url: urlTarefa(id, '/historico'),
    headers: auth(token),
  });
  expect(resposta.statusCode).toBe(200);
  return z.array(EsquemaEventoTarefa).parse(resposta.json());
}

type Parte = { nome: string; valor: string } | { nome: string; arquivo: Buffer };

function concluir(id: string, partes: Parte[], token = tokenAna) {
  const blocos: Buffer[] = [];
  for (const parte of partes) {
    const cabecalho =
      'arquivo' in parte
        ? `Content-Disposition: form-data; name="${parte.nome}"; filename="arte.pdf"\r\nContent-Type: application/pdf`
        : `Content-Disposition: form-data; name="${parte.nome}"`;
    blocos.push(Buffer.from(`--${FRONTEIRA}\r\n${cabecalho}\r\n\r\n`));
    blocos.push('arquivo' in parte ? parte.arquivo : Buffer.from(parte.valor));
    blocos.push(Buffer.from('\r\n'));
  }
  blocos.push(Buffer.from(`--${FRONTEIRA}--\r\n`));
  return app.inject({
    method: 'POST',
    url: urlTarefa(id, '/concluir'),
    payload: Buffer.concat(blocos),
    headers: {
      'content-type': `multipart/form-data; boundary=${FRONTEIRA}`,
      ...auth(token),
    },
  });
}

const camposArte = (): Parte[] => [
  { nome: 'nome', valor: 'Estampa Ficticia' },
  { nome: 'corId', valor: corId },
  { nome: 'maquinaIds', valor: maquinaId },
  { nome: 'pdf', arquivo: PDF_MINIMO },
];

describe('POST /clientes/:id/produtos/:produtoId/tarefas', () => {
  it('cria Não iniciado, com quem criou como responsável e o primeiro evento no histórico', async () => {
    const tarefa = await criar();
    expect(tarefa).toMatchObject({
      cliente: { id: clienteId, nome: 'Pizzaria Ficticia' },
      produto: { id: produtoId, nome: 'Caixa de pizza 35x35' },
      responsavel: { nome: 'Ana Ficticia' },
      status: 'nao_iniciada',
      arteId: null,
    });
    const eventos = await historico(tarefa.id);
    expect(eventos).toHaveLength(1);
    expect(eventos[0]).toMatchObject({
      statusAnterior: null,
      statusNovo: 'nao_iniciada',
      autor: { nome: 'Ana Ficticia' },
    });
  });

  it('cliente ou produto inexistentes ou de outra empresa: 404', async () => {
    const roma = await empresaId('roma');
    const [produtoRoma] = await db
      .insert(produtos)
      .values({ empresaId: roma, nome: 'Copo Ficticio' })
      .returning();
    const casos: [string, string][] = [
      [urlCriar(crypto.randomUUID()), 'cliente_nao_encontrado'],
      [urlCriar(clienteId, crypto.randomUUID()), 'produto_nao_encontrado'],
      [urlCriar(clienteId, produtoRoma!.id), 'produto_nao_encontrado'],
      [urlCriar('x'), 'cliente_nao_encontrado'],
    ];
    for (const [url, codigo] of casos) {
      const resposta = await app.inject({ method: 'POST', url, headers: auth(tokenAna) });
      esperarErro(resposta, 404, codigo);
    }
  });

  it('sem login: 401', async () => {
    const resposta = await app.inject({ method: 'POST', url: urlCriar() });
    esperarErro(resposta, 401, 'nao_autenticado');
  });
});

describe('GET /tarefas', () => {
  it('o arte finalista só vê as próprias, qualquer que seja o escopo', async () => {
    const daAna = await criar(tokenAna);
    await criar(tokenBia);
    for (const consulta of ['', '?escopo=todas', '?escopo=andamento']) {
      const tarefas = z.array(EsquemaTarefa).parse((await listar(tokenAna, consulta)).json());
      expect(tarefas.map((t) => t.id)).toEqual([daAna.id]);
    }
  });

  it('o admin vê as em andamento de todos, e o filtro de status', async () => {
    const a = await criar(tokenAna);
    const b = await criar(tokenBia);
    expect((await mudar(b.id, 'cancelada', tokenBia)).statusCode).toBe(200);

    const andamento = z
      .array(EsquemaTarefa)
      .parse((await listar(tokenAdmin, '?escopo=andamento')).json());
    expect(andamento.map((t) => t.id)).toEqual([a.id]);

    const todas = z.array(EsquemaTarefa).parse((await listar(tokenAdmin, '?escopo=todas')).json());
    expect(todas.map((t) => t.id).sort()).toEqual([a.id, b.id].sort());

    const canceladas = z
      .array(EsquemaTarefa)
      .parse((await listar(tokenAdmin, '?escopo=todas&status=cancelada')).json());
    expect(canceladas.map((t) => t.id)).toEqual([b.id]);

    const minhas = z
      .array(EsquemaTarefa)
      .parse((await listar(tokenAdmin, '?escopo=minhas')).json());
    expect(minhas).toEqual([]);
  });

  it('consulta inválida: 400', async () => {
    esperarErro(await listar(tokenAdmin, '?escopo=outras'), 400, 'requisicao_invalida');
  });
});

describe('GET /tarefas/contagem', () => {
  const contar = async (token: string, empresa = 'aba') => {
    const resposta = await app.inject({
      method: 'GET',
      url: `/v1/empresas/${empresa}/tarefas/contagem`,
      headers: auth(token),
    });
    expect(resposta.statusCode).toBe(200);
    return EsquemaContagemTarefas.parse(resposta.json());
  };

  it('sem tarefas: tudo 0', async () => {
    expect(await contar(tokenAdmin)).toEqual({
      nao_iniciada: 0,
      em_desenvolvimento: 0,
      aguardando_cliente: 0,
    });
  });

  it('o admin conta todas da empresa; o arte finalista, só as próprias; terminadas não contam', async () => {
    await criar(tokenAna);
    const a2 = await criar(tokenAna);
    const b1 = await criar(tokenBia);
    const b2 = await criar(tokenBia);
    expect((await mudar(a2.id, 'em_desenvolvimento', tokenAna)).statusCode).toBe(200);
    expect((await mudar(b1.id, 'aguardando_cliente', tokenBia)).statusCode).toBe(200);
    expect((await mudar(b2.id, 'cancelada', tokenBia)).statusCode).toBe(200);

    expect(await contar(tokenAdmin)).toEqual({
      nao_iniciada: 1,
      em_desenvolvimento: 1,
      aguardando_cliente: 1,
    });
    expect(await contar(tokenAna)).toEqual({
      nao_iniciada: 1,
      em_desenvolvimento: 1,
      aguardando_cliente: 0,
    });
    expect(await contar(tokenBia)).toEqual({
      nao_iniciada: 0,
      em_desenvolvimento: 0,
      aguardando_cliente: 1,
    });
  });

  it('tarefas de outra empresa não entram', async () => {
    const roma = await empresaId('roma');
    const [clienteRoma] = await db
      .insert(clientes)
      .values({ empresaId: roma, razaoSocial: 'Copos Ficticios Ltda', cnpj: gerarCnpj(8) })
      .returning();
    const [produtoRoma] = await db
      .insert(produtos)
      .values({ empresaId: roma, nome: 'Copo Ficticio' })
      .returning();
    const [usuario] = await db.select().from(usuarios).where(eq(usuarios.email, 'adm@exemplo.com'));
    await db.insert(tarefasArte).values({
      empresaId: roma,
      clienteId: clienteRoma!.id,
      produtoId: produtoRoma!.id,
      responsavelId: usuario!.id,
    });
    await criar(tokenAna);
    expect((await contar(tokenAdmin)).nao_iniciada).toBe(1);
  });

  it('sem login: 401', async () => {
    const resposta = await app.inject({ method: 'GET', url: '/v1/empresas/aba/tarefas/contagem' });
    esperarErro(resposta, 401, 'nao_autenticado');
  });
});

describe('alcance', () => {
  it('a tarefa de outro arte finalista responde 404; o admin alcança', async () => {
    const tarefa = await criar(tokenAna);
    const detalhe = await app.inject({
      method: 'GET',
      url: urlTarefa(tarefa.id),
      headers: auth(tokenBia),
    });
    esperarErro(detalhe, 404, 'tarefa_nao_encontrada');
    esperarErro(
      await mudar(tarefa.id, 'em_desenvolvimento', tokenBia),
      404,
      'tarefa_nao_encontrada',
    );

    expect((await mudar(tarefa.id, 'em_desenvolvimento', tokenAdmin)).statusCode).toBe(200);
    const eventos = await historico(tarefa.id, tokenAdmin);
    expect(eventos.at(-1)?.autor?.nome).toBe('Admin Ficticio');
  });
});

describe('PATCH /tarefas/:id/status', () => {
  it('muda para qualquer status e grava cada mudança; o mesmo status não gera evento', async () => {
    const tarefa = await criar();
    for (const status of [
      'em_desenvolvimento',
      'aguardando_cliente',
      'cancelada',
      'nao_iniciada',
    ]) {
      const resposta = await mudar(tarefa.id, status);
      expect(resposta.statusCode).toBe(200);
      expect(EsquemaTarefa.parse(resposta.json()).status).toBe(status);
    }
    expect((await mudar(tarefa.id, 'nao_iniciada')).statusCode).toBe(200);
    const eventos = await historico(tarefa.id);
    expect(eventos.map((e) => [e.statusAnterior, e.statusNovo])).toEqual([
      [null, 'nao_iniciada'],
      ['nao_iniciada', 'em_desenvolvimento'],
      ['em_desenvolvimento', 'aguardando_cliente'],
      ['aguardando_cliente', 'cancelada'],
      ['cancelada', 'nao_iniciada'],
    ]);
  });

  it('concluir sem arte: 409, e nada muda', async () => {
    const tarefa = await criar();
    esperarErro(await mudar(tarefa.id, 'concluida'), 409, 'tarefa_sem_arte');
    expect(await historico(tarefa.id)).toHaveLength(1);
  });

  it('status desconhecido: 400', async () => {
    const tarefa = await criar();
    esperarErro(await mudar(tarefa.id, 'pausada'), 400, 'requisicao_invalida');
  });
});

describe('POST /tarefas/:id/concluir', () => {
  it('cadastra a arte do cliente e produto da tarefa e conclui', async () => {
    const tarefa = await criar();
    await mudar(tarefa.id, 'em_desenvolvimento');
    const resposta = await concluir(tarefa.id, camposArte());
    expect(resposta.statusCode).toBe(200);
    const concluida = EsquemaTarefa.parse(resposta.json());
    expect(concluida.status).toBe('concluida');
    expect(concluida.arteId).not.toBeNull();

    const artes = await app.inject({
      method: 'GET',
      url: `/v1/empresas/aba/clientes/${clienteId}/produtos/${produtoId}/artes`,
      headers: auth(tokenAna),
    });
    const lista = z.array(EsquemaArteDoProduto).parse(artes.json());
    expect(lista.map((a) => [a.id, a.nome])).toEqual([[concluida.arteId, 'Estampa Ficticia']]);

    const eventos = await historico(tarefa.id);
    expect(eventos.at(-1)).toMatchObject({
      statusAnterior: 'em_desenvolvimento',
      statusNovo: 'concluida',
    });
  });

  it('sem arquivo: 422 e a tarefa continua como estava', async () => {
    const tarefa = await criar();
    const resposta = await concluir(
      tarefa.id,
      camposArte().filter((p) => p.nome !== 'pdf'),
    );
    esperarErro(resposta, 422, 'validacao');
    expect(await historico(tarefa.id)).toHaveLength(1);
  });

  it('com arte, reabrir e concluir de novo só muda o status; concluir com arte de novo: 409', async () => {
    const tarefa = await criar();
    expect((await concluir(tarefa.id, camposArte())).statusCode).toBe(200);
    expect((await mudar(tarefa.id, 'aguardando_cliente')).statusCode).toBe(200);
    esperarErro(await concluir(tarefa.id, camposArte()), 409, 'tarefa_com_arte');
    const resposta = await mudar(tarefa.id, 'concluida');
    expect(EsquemaTarefa.parse(resposta.json()).status).toBe('concluida');
  });

  it('a arte da tarefa não pode ser removida', async () => {
    const tarefa = await criar();
    const concluida = EsquemaTarefa.parse((await concluir(tarefa.id, camposArte())).json());
    const resposta = await app.inject({
      method: 'DELETE',
      url: `/v1/empresas/aba/artes/${concluida.arteId}`,
      headers: auth(tokenAdmin),
    });
    esperarErro(resposta, 409, 'arte_em_tarefa');
  });
});

describe('comentários', () => {
  it('grava com autor e data e aparece no detalhe, em ordem', async () => {
    const tarefa = await criar();
    for (const [texto, token] of [
      ['Cliente pediu fundo azul', tokenAna],
      ['  Ok, aguardando  ', tokenAdmin],
    ] as const) {
      const resposta = await app.inject({
        method: 'POST',
        url: urlTarefa(tarefa.id, '/comentarios'),
        headers: auth(token),
        payload: { texto },
      });
      expect(resposta.statusCode).toBe(201);
      EsquemaComentarioTarefa.parse(resposta.json());
    }
    const detalhe = EsquemaTarefaDetalhe.parse(
      (
        await app.inject({ method: 'GET', url: urlTarefa(tarefa.id), headers: auth(tokenAna) })
      ).json(),
    );
    expect(detalhe.comentarios.map((c) => [c.autor?.nome, c.texto])).toEqual([
      ['Ana Ficticia', 'Cliente pediu fundo azul'],
      ['Admin Ficticio', 'Ok, aguardando'],
    ]);
  });

  it('comentário vazio: 400', async () => {
    const tarefa = await criar();
    const resposta = await app.inject({
      method: 'POST',
      url: urlTarefa(tarefa.id, '/comentarios'),
      headers: auth(tokenAna),
      payload: { texto: '   ' },
    });
    esperarErro(resposta, 400, 'requisicao_invalida');
  });
});

describe('anexos nos comentários', () => {
  type Anexo = { nome: string; conteudo: Buffer };

  function comentarComAnexos(
    id: string,
    { texto, anexos = [] }: { texto?: string; anexos?: Anexo[] },
    token = tokenAna,
    alvo: FastifyInstance = app,
  ) {
    const blocos: Buffer[] = [];
    if (texto !== undefined) {
      blocos.push(
        Buffer.from(
          `--${FRONTEIRA}\r\nContent-Disposition: form-data; name="texto"\r\n\r\n${texto}\r\n`,
        ),
      );
    }
    for (const anexo of anexos) {
      blocos.push(
        Buffer.from(
          `--${FRONTEIRA}\r\nContent-Disposition: form-data; name="anexos"; filename="${anexo.nome}"\r\nContent-Type: application/octet-stream\r\n\r\n`,
        ),
        anexo.conteudo,
        Buffer.from('\r\n'),
      );
    }
    blocos.push(Buffer.from(`--${FRONTEIRA}--\r\n`));
    return alvo.inject({
      method: 'POST',
      url: urlTarefa(id, '/comentarios'),
      payload: Buffer.concat(blocos),
      headers: { 'content-type': `multipart/form-data; boundary=${FRONTEIRA}`, ...auth(token) },
    });
  }

  const baixar = (tarefaId: string, comentarioId: string, anexoId: string, token = tokenAna) =>
    app.inject({
      method: 'GET',
      url: urlTarefa(tarefaId, `/comentarios/${comentarioId}/anexos/${anexoId}`),
      headers: auth(token),
    });

  const pdf = (nome = 'briefing.pdf'): Anexo => ({ nome, conteudo: PDF_MINIMO });

  it('só anexo: texto vazio e o anexo com nome, tipo e tamanho', async () => {
    const tarefa = await criar();
    const resposta = await comentarComAnexos(tarefa.id, { anexos: [pdf()] });
    expect(resposta.statusCode).toBe(201);
    const comentario = EsquemaComentarioTarefa.parse(resposta.json());
    expect(comentario.texto).toBe('');
    expect(comentario.anexos).toEqual([
      {
        id: expect.any(String),
        nome: 'briefing.pdf',
        tipoMime: 'application/pdf',
        tamanho: PDF_MINIMO.length,
      },
    ]);
  });

  it('texto e anexos: na ordem do envio, também no detalhe da tarefa', async () => {
    const tarefa = await criar();
    const resposta = await comentarComAnexos(tarefa.id, {
      texto: '  Segue o material  ',
      anexos: [pdf('a.pdf'), { nome: 'b.png', conteudo: PNG_1X1 }],
    });
    expect(resposta.statusCode).toBe(201);
    const detalhe = EsquemaTarefaDetalhe.parse(
      (
        await app.inject({ method: 'GET', url: urlTarefa(tarefa.id), headers: auth(tokenAna) })
      ).json(),
    );
    expect(detalhe.comentarios[0]?.texto).toBe('Segue o material');
    expect(detalhe.comentarios[0]?.anexos.map((a) => [a.nome, a.tipoMime])).toEqual([
      ['a.pdf', 'application/pdf'],
      ['b.png', 'image/png'],
    ]);
  });

  it('só texto em JSON continua funcionando, sem anexos', async () => {
    const tarefa = await criar();
    const resposta = await app.inject({
      method: 'POST',
      url: urlTarefa(tarefa.id, '/comentarios'),
      headers: auth(tokenAna),
      payload: { texto: 'Sem anexo' },
    });
    expect(EsquemaComentarioTarefa.parse(resposta.json()).anexos).toEqual([]);
  });

  it('6 anexos: 400; sem texto nem anexo: 400; tipo trocado: 415', async () => {
    const tarefa = await criar();
    const seis = Array.from({ length: 6 }, (_, i) => pdf(`a${i}.pdf`));
    esperarErro(await comentarComAnexos(tarefa.id, { anexos: seis }), 400, 'anexos_demais');
    esperarErro(await comentarComAnexos(tarefa.id, { texto: '  ' }), 400, 'comentario_vazio');
    const trocado = { nome: 'falso.pdf', conteudo: Buffer.from('texto qualquer, não é PDF') };
    esperarErro(
      await comentarComAnexos(tarefa.id, { anexos: [trocado] }),
      415,
      'tipo_nao_suportado',
    );
    const detalhe = EsquemaTarefaDetalhe.parse(
      (
        await app.inject({ method: 'GET', url: urlTarefa(tarefa.id), headers: auth(tokenAna) })
      ).json(),
    );
    expect(detalhe.comentarios).toEqual([]);
  });

  it('download: quem alcança a tarefa baixa; outro arte finalista e anexo de outro comentário, 404', async () => {
    const tarefa = await criar();
    const comentario = EsquemaComentarioTarefa.parse(
      (await comentarComAnexos(tarefa.id, { anexos: [pdf('Briefing ção.pdf')] })).json(),
    );
    const anexo = comentario.anexos[0]!;

    const daAna = await baixar(tarefa.id, comentario.id, anexo.id);
    expect(daAna.statusCode).toBe(200);
    expect(daAna.headers['content-type']).toBe('application/pdf');
    expect(daAna.headers['content-disposition']).toMatch(/^attachment; /);
    expect(daAna.headers['x-content-type-options']).toBe('nosniff');
    expect(daAna.rawPayload.equals(PDF_MINIMO)).toBe(true);
    expect((await baixar(tarefa.id, comentario.id, anexo.id, tokenAdmin)).statusCode).toBe(200);

    esperarErro(
      await baixar(tarefa.id, comentario.id, anexo.id, tokenBia),
      404,
      'anexo_nao_encontrado',
    );
    const outro = EsquemaComentarioTarefa.parse(
      (await comentarComAnexos(tarefa.id, { texto: 'outro' })).json(),
    );
    esperarErro(await baixar(tarefa.id, outro.id, anexo.id), 404, 'anexo_nao_encontrado');
    esperarErro(await baixar(tarefa.id, comentario.id, 'x'), 404, 'anexo_nao_encontrado');
  });

  it('com o bucket configurado, o anexo vai para o bucket e o download lê de lá', async () => {
    const armazem = criarArmazemTeste();
    await limparBucket(armazem);
    const { app: comBucket } = criarAppTeste(db, { armazem });
    try {
      const tarefa = await criar();
      const resposta = await comentarComAnexos(
        tarefa.id,
        { anexos: [{ nome: 'ref.png', conteudo: PNG_1X1 }] },
        tokenAna,
        comBucket,
      );
      expect(resposta.statusCode).toBe(201);
      const comentario = EsquemaComentarioTarefa.parse(resposta.json());
      expect(await chavesNoBucket(armazem)).toHaveLength(1);
      const baixado = await comBucket.inject({
        method: 'GET',
        url: urlTarefa(
          tarefa.id,
          `/comentarios/${comentario.id}/anexos/${comentario.anexos[0]!.id}`,
        ),
        headers: auth(tokenAna),
      });
      expect(baixado.statusCode).toBe(200);
      expect(baixado.rawPayload.equals(PNG_1X1)).toBe(true);
    } finally {
      await comBucket.close();
      await limparBucket(armazem);
    }
  });
});
