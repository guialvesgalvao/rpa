import {
  EsquemaComentarioCompra,
  EsquemaErro,
  EsquemaPedidoCompra,
  EsquemaPedidoCompraDetalhe,
  EsquemaRespostaEntrar,
  type Permissao,
} from '@plataforma/contratos';
import { eq } from 'drizzle-orm';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { PDF_MINIMO, PNG_1X1 } from '../../src/cli/semear-dev.js';
import { empresas, produtos } from '../../src/db/esquema.js';
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
let pedro: string;
let paula: string;
let ana: string;
let insumoId: string;

async function entrar(email: string, permissoes: Permissao[]) {
  await criarUsuario(db, {
    email,
    nome: `Pessoa ${email}`,
    senha: SENHA,
    empresas: ['roma'],
    permissoes: { roma: permissoes },
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
  const [roma] = await db.select().from(empresas).where(eq(empresas.slug, 'roma'));
  const [insumo] = await db
    .insert(produtos)
    .values({ empresaId: roma!.id, codigo: 'TPP001', nome: 'Tinta Ficticia' })
    .returning();
  insumoId = insumo!.id;
  pedro = await entrar('pedro@exemplo.com', ['compras', 'compras.pedir']);
  paula = await entrar('paula@exemplo.com', ['compras', 'compras.pedir']);
  ana = await entrar('ana@exemplo.com', ['compras', 'compras.acompanhar']);
});
afterEach(() => app.close());

const auth = (token: string) => ({ authorization: `Bearer ${token}` });
const url = (pedidoId: string, sufixo = '') =>
  `/v1/empresas/roma/compras/pedidos/${pedidoId}${sufixo}`;

function esperarErro(resposta: LightMyRequestResponse, status: number, codigo: string) {
  expect(resposta.statusCode).toBe(status);
  expect(EsquemaErro.parse(resposta.json()).erro.codigo).toBe(codigo);
}

async function pedir(token = pedro) {
  const resposta = await app.inject({
    method: 'POST',
    url: '/v1/empresas/roma/compras/pedidos',
    headers: auth(token),
    payload: { insumoId, quantidade: 5 },
  });
  expect(resposta.statusCode).toBe(201);
  return EsquemaPedidoCompra.parse(resposta.json());
}

const comentarTexto = (pedidoId: string, texto: unknown, token = pedro) =>
  app.inject({
    method: 'POST',
    url: url(pedidoId, '/comentarios'),
    headers: auth(token),
    payload: { texto },
  });

type Anexo = { nome: string; conteudo: Buffer };

function comentarComAnexos(
  pedidoId: string,
  { texto, anexos = [] }: { texto?: string; anexos?: Anexo[] },
  token = pedro,
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
    url: url(pedidoId, '/comentarios'),
    payload: Buffer.concat(blocos),
    headers: { 'content-type': `multipart/form-data; boundary=${FRONTEIRA}`, ...auth(token) },
  });
}

const baixar = (pedidoId: string, comentarioId: string, anexoId: string, token = pedro) =>
  app.inject({
    method: 'GET',
    url: url(pedidoId, `/comentarios/${comentarioId}/anexos/${anexoId}`),
    headers: auth(token),
  });

async function detalhe(pedidoId: string, token = pedro) {
  const resposta = await app.inject({ method: 'GET', url: url(pedidoId), headers: auth(token) });
  expect(resposta.statusCode).toBe(200);
  return EsquemaPedidoCompraDetalhe.parse(resposta.json());
}

describe('comentários dos pedidos', () => {
  it('texto: o detalhe do pedido traz os comentários em ordem, com o autor', async () => {
    const pedido = await pedir();
    expect((await detalhe(pedido.id)).comentarios).toEqual([]);
    expect((await comentarTexto(pedido.id, '  primeiro  ')).statusCode).toBe(201);
    expect((await comentarTexto(pedido.id, 'segundo', ana)).statusCode).toBe(201);
    const { comentarios } = await detalhe(pedido.id);
    expect(comentarios.map((c) => c.texto)).toEqual(['primeiro', 'segundo']);
    expect(comentarios[0]?.autor?.nome).toBe('Pessoa pedro@exemplo.com');
    expect(comentarios[1]?.anexos).toEqual([]);
  });

  it('texto vazio ou longo demais é recusado', async () => {
    const pedido = await pedir();
    esperarErro(await comentarTexto(pedido.id, '   '), 400, 'requisicao_invalida');
    esperarErro(await comentarTexto(pedido.id, 'x'.repeat(2001)), 400, 'requisicao_invalida');
    esperarErro(await comentarComAnexos(pedido.id, { texto: '' }), 400, 'comentario_vazio');
  });

  it('só anexo: texto vazio e o anexo com nome, tipo e tamanho; o download devolve os bytes', async () => {
    const pedido = await pedir();
    const resposta = await comentarComAnexos(pedido.id, {
      anexos: [{ nome: 'cotacao.pdf', conteudo: PDF_MINIMO }],
    });
    expect(resposta.statusCode).toBe(201);
    const comentario = EsquemaComentarioCompra.parse(resposta.json());
    expect(comentario.texto).toBe('');
    expect(comentario.anexos).toEqual([
      {
        id: expect.any(String),
        nome: 'cotacao.pdf',
        tipoMime: 'application/pdf',
        tamanho: PDF_MINIMO.length,
      },
    ]);
    const baixado = await baixar(pedido.id, comentario.id, comentario.anexos[0]!.id);
    expect(baixado.statusCode).toBe(200);
    expect(baixado.headers['content-type']).toBe('application/pdf');
    expect(baixado.rawPayload.equals(PDF_MINIMO)).toBe(true);
  });

  it('recusa tipo que não é PDF nem imagem e anexos demais', async () => {
    const pedido = await pedir();
    esperarErro(
      await comentarComAnexos(pedido.id, {
        anexos: [{ nome: 'planilha.csv', conteudo: Buffer.from('a;b\n1;2') }],
      }),
      415,
      'tipo_nao_suportado',
    );
    esperarErro(
      await comentarComAnexos(pedido.id, {
        anexos: Array.from({ length: 6 }, (_, i) => ({ nome: `f${i}.png`, conteudo: PNG_1X1 })),
      }),
      400,
      'anexos_demais',
    );
  });

  it('quem não alcança o pedido não comenta nem baixa; quem acompanha, sim', async () => {
    const pedido = await pedir();
    esperarErro(await comentarTexto(pedido.id, 'oi', paula), 404, 'pedido_nao_encontrado');
    const resposta = await comentarComAnexos(
      pedido.id,
      { texto: 'segue a foto', anexos: [{ nome: 'foto.png', conteudo: PNG_1X1 }] },
      ana,
    );
    expect(resposta.statusCode).toBe(201);
    const comentario = EsquemaComentarioCompra.parse(resposta.json());
    const anexoId = comentario.anexos[0]!.id;
    expect((await baixar(pedido.id, comentario.id, anexoId)).statusCode).toBe(200);
    esperarErro(
      await baixar(pedido.id, comentario.id, anexoId, paula),
      404,
      'anexo_nao_encontrado',
    );

    // O anexo é só deste pedido e deste comentário.
    const outro = await pedir();
    esperarErro(await baixar(outro.id, comentario.id, anexoId), 404, 'anexo_nao_encontrado');
    esperarErro(await baixar(pedido.id, comentario.id, 'x'), 404, 'anexo_nao_encontrado');
  });

  it('pedido terminado continua aceitando comentário', async () => {
    const pedido = await pedir();
    await app.inject({
      method: 'PATCH',
      url: url(pedido.id, '/status'),
      headers: auth(ana),
      payload: { status: 'concluida' },
    });
    expect((await comentarTexto(pedido.id, 'recebido')).statusCode).toBe(201);
  });

  it('com o bucket configurado, o anexo vai para o bucket e o download lê de lá', async () => {
    const armazem = criarArmazemTeste();
    await limparBucket(armazem);
    const { app: comBucket } = criarAppTeste(db, { armazem });
    try {
      const pedido = await pedir();
      const resposta = await comentarComAnexos(
        pedido.id,
        { anexos: [{ nome: 'ref.png', conteudo: PNG_1X1 }] },
        pedro,
        comBucket,
      );
      expect(resposta.statusCode).toBe(201);
      const comentario = EsquemaComentarioCompra.parse(resposta.json());
      expect(await chavesNoBucket(armazem)).toHaveLength(1);
      const baixado = await comBucket.inject({
        method: 'GET',
        url: url(pedido.id, `/comentarios/${comentario.id}/anexos/${comentario.anexos[0]!.id}`),
        headers: auth(pedro),
      });
      expect(baixado.statusCode).toBe(200);
      expect(baixado.rawPayload.equals(PNG_1X1)).toBe(true);
    } finally {
      await comBucket.close();
      await limparBucket(armazem);
    }
  });
});
