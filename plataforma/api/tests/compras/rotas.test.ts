import {
  type Area,
  EsquemaErro,
  EsquemaEventoCompra,
  EsquemaInsumo,
  EsquemaPedidoCompra,
  EsquemaRespostaEntrar,
  type Permissao,
} from '@plataforma/contratos';
import { eq } from 'drizzle-orm';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { empresas, produtos, usuarioEmpresas, usuarios } from '../../src/db/esquema.js';
import { criarUsuario } from '../../src/usuarios/servico.js';
import { criarAppTeste } from '../helpers/app.js';
import { criarBancoTeste, limparTabelas } from '../helpers/banco.js';

// Dados sintéticos.
const { db, fechar } = criarBancoTeste();
afterAll(() => fechar());

const SENHA = 'senha-ficticia-123';
const PEDE: Permissao[] = ['compras', 'compras.pedir'];
const ACOMPANHA: Permissao[] = ['compras', 'compras.pedir', 'compras.acompanhar'];

let app: FastifyInstance;
let pedro: { id: string; token: string };
let paula: { id: string; token: string };
let ana: { id: string; token: string };
let semCompras: { id: string; token: string };
let tpp1: string;
let tpp2: string;
let tppInativo: string;
let caixa: string;

async function pessoa(
  email: string,
  nome: string,
  permissoes: Record<string, Permissao[]>,
  area: Area | null = null,
) {
  const criado = await criarUsuario(db, {
    email,
    nome,
    area,
    senha: SENHA,
    empresas: Object.keys(permissoes),
    permissoes,
  });
  const resposta = await app.inject({
    method: 'POST',
    url: '/v1/auth/entrar',
    payload: { email, senha: SENHA, origem: 'web' },
  });
  return { id: criado.id, token: EsquemaRespostaEntrar.parse(resposta.json()).acesso };
}

async function produto(empresaId: string, codigo: string, nome: string, inativo = false) {
  const [linha] = await db
    .insert(produtos)
    .values({ empresaId, codigo, nome, inativoNoBlingEm: inativo ? new Date() : null })
    .returning();
  return linha!.id;
}

beforeEach(async () => {
  await limparTabelas(db);
  ({ app } = criarAppTeste(db));
  const [roma] = await db.select().from(empresas).where(eq(empresas.slug, 'roma'));
  tpp2 = await produto(roma!.id, 'TPP002', 'Fita Ficticia');
  tpp1 = await produto(roma!.id, 'TPP001', 'Tinta Ficticia');
  tppInativo = await produto(roma!.id, 'TPP009', 'Cola Ficticia', true);
  caixa = await produto(roma!.id, 'CX-35', 'Caixa Ficticia');
  pedro = await pessoa('pedro@exemplo.com', 'Pedro Ficticio', { roma: PEDE }, 'producao');
  paula = await pessoa('paula@exemplo.com', 'Paula Ficticia', { roma: PEDE });
  ana = await pessoa('ana@exemplo.com', 'Ana Ficticia', { roma: ACOMPANHA, aba: ACOMPANHA });
  semCompras = await pessoa('sem@exemplo.com', 'Sem Compras', { roma: ['artes'] });
});
afterEach(() => app.close());

const chamar = (
  method: 'GET' | 'POST' | 'PATCH',
  caminho: string,
  token: string,
  payload?: object,
  empresa = 'roma',
) =>
  app.inject({
    method,
    url: `/v1/empresas/${empresa}/compras${caminho}`,
    headers: { authorization: `Bearer ${token}` },
    ...(payload ? { payload } : {}),
  });

function esperarErro(resposta: LightMyRequestResponse, status: number, codigo: string) {
  expect(resposta.statusCode).toBe(status);
  expect(EsquemaErro.parse(resposta.json()).erro.codigo).toBe(codigo);
}

async function pedir(token = pedro.token, corpo: object = { insumoId: tpp1, quantidade: 10 }) {
  const resposta = await chamar('POST', '/pedidos', token, corpo);
  expect(resposta.statusCode).toBe(201);
  return EsquemaPedidoCompra.parse(resposta.json());
}

function ok(resposta: LightMyRequestResponse) {
  expect(resposta.statusCode).toBe(200);
  return EsquemaPedidoCompra.parse(resposta.json());
}

async function listar(token: string, consulta = '') {
  const resposta = await chamar('GET', `/pedidos${consulta}`, token);
  expect(resposta.statusCode).toBe(200);
  return z.array(EsquemaPedidoCompra).parse(resposta.json());
}

async function historico(id: string, token = ana.token) {
  const resposta = await chamar('GET', `/pedidos/${id}/historico`, token);
  expect(resposta.statusCode).toBe(200);
  return z.array(EsquemaEventoCompra).parse(resposta.json());
}

describe('insumos', () => {
  it('lista só os produtos ativos com código TPP, por código', async () => {
    const resposta = await chamar('GET', '/insumos', pedro.token);
    expect(resposta.statusCode).toBe(200);
    expect(z.array(EsquemaInsumo).parse(resposta.json())).toEqual([
      { id: tpp1, codigo: 'TPP001', nome: 'Tinta Ficticia' },
      { id: tpp2, codigo: 'TPP002', nome: 'Fita Ficticia' },
    ]);
  });

  it('exige compras.pedir', async () => {
    esperarErro(await chamar('GET', '/insumos', semCompras.token), 403, 'permissao_proibida');
  });
});

describe('criar pedido', () => {
  it('nasce aberto, sem responsável, com a área do criador e o evento de criação', async () => {
    const pedido = await pedir(pedro.token, {
      insumoId: tpp1,
      quantidade: 2.5,
      observacao: ' urgente ',
    });
    expect(pedido).toMatchObject({
      insumo: { id: tpp1, codigo: 'TPP001', nome: 'Tinta Ficticia' },
      quantidade: 2.5,
      observacao: 'urgente',
      status: 'aberta',
      criador: { id: pedro.id, nome: 'Pedro Ficticio' },
      areaCriador: 'producao',
      responsavel: null,
    });
    const eventos = await historico(pedido.id, pedro.token);
    expect(eventos.map((e) => e.dados)).toEqual([{ tipo: 'criacao' }]);
    expect(eventos[0]?.autor).toEqual({ id: pedro.id, nome: 'Pedro Ficticio' });
  });

  it('a área é uma cópia: mudar a área do criador não muda o pedido', async () => {
    const pedido = await pedir();
    await db.update(usuarios).set({ area: 'direcao' }).where(eq(usuarios.id, pedro.id));
    expect(ok(await chamar('GET', `/pedidos/${pedido.id}`, pedro.token)).areaCriador).toBe(
      'producao',
    );
  });

  it('sem área, o pedido fica sem área', async () => {
    expect((await pedir(paula.token)).areaCriador).toBeNull();
  });

  it('recusa insumo sem código TPP, inativo ou inexistente', async () => {
    for (const insumoId of [caixa, tppInativo, '7b0e6c0a-3f5e-4c59-9d0a-2f3c1a4b5d6e']) {
      esperarErro(
        await chamar('POST', '/pedidos', pedro.token, { insumoId, quantidade: 1 }),
        400,
        'insumo_invalido',
      );
    }
  });

  it('recusa quantidade inválida', async () => {
    for (const quantidade of [0, -2, 1.0001, '3']) {
      esperarErro(
        await chamar('POST', '/pedidos', pedro.token, { insumoId: tpp1, quantidade }),
        400,
        'requisicao_invalida',
      );
    }
  });

  it('exige compras.pedir: só o módulo não basta', async () => {
    const soModulo = await pessoa('modulo@exemplo.com', 'So Modulo', { roma: ['compras'] });
    esperarErro(
      await chamar('POST', '/pedidos', soModulo.token, { insumoId: tpp1, quantidade: 1 }),
      403,
      'permissao_proibida',
    );
  });
});

describe('alcance', () => {
  it('quem só pede vê os próprios; quem acompanha vê todos', async () => {
    const doPedro = await pedir(pedro.token);
    const daPaula = await pedir(paula.token);

    expect((await listar(pedro.token, '?escopo=todos')).map((p) => p.id)).toEqual([doPedro.id]);
    esperarErro(
      await chamar('GET', `/pedidos/${doPedro.id}`, paula.token),
      404,
      'pedido_nao_encontrado',
    );
    esperarErro(
      await chamar('GET', `/pedidos/${doPedro.id}/historico`, paula.token),
      404,
      'pedido_nao_encontrado',
    );
    expect((await listar(ana.token, '?escopo=todos')).map((p) => p.id).sort()).toEqual(
      [doPedro.id, daPaula.id].sort(),
    );
    ok(await chamar('GET', `/pedidos/${daPaula.id}`, ana.token));
  });

  it('escopos: meus (criados ou assumidos), abertos (não terminados) e por status', async () => {
    const assumido = await pedir(pedro.token);
    const concluido = await pedir(paula.token);
    const daAna = await pedir(ana.token);
    ok(await chamar('POST', `/pedidos/${assumido.id}/assumir`, ana.token));
    ok(
      await chamar('PATCH', `/pedidos/${concluido.id}/status`, ana.token, { status: 'concluida' }),
    );

    const ids = async (consulta: string) =>
      (await listar(ana.token, consulta)).map((p) => p.id).sort();
    expect(await ids('')).toEqual([assumido.id, daAna.id].sort());
    expect(await ids('?escopo=abertos')).toEqual([assumido.id, daAna.id].sort());
    expect(await ids('?escopo=todos&status=concluida')).toEqual([concluido.id]);
    expect(await ids('?escopo=todos')).toHaveLength(3);
    esperarErro(
      await chamar('GET', '/pedidos?escopo=outro', ana.token),
      400,
      'requisicao_invalida',
    );
  });

  it('id que não é uuid responde 404', async () => {
    esperarErro(await chamar('GET', '/pedidos/abc', ana.token), 404, 'pedido_nao_encontrado');
  });
});

describe('assumir', () => {
  it('define o responsável, passa para Em andamento e grava os dois eventos em ordem', async () => {
    const pedido = await pedir();
    const assumido = ok(await chamar('POST', `/pedidos/${pedido.id}/assumir`, ana.token));
    expect(assumido).toMatchObject({
      status: 'em_andamento',
      responsavel: { id: ana.id, nome: 'Ana Ficticia' },
    });
    // Repetir não muda nada.
    ok(await chamar('POST', `/pedidos/${pedido.id}/assumir`, ana.token));
    expect((await historico(pedido.id)).map((e) => e.dados)).toEqual([
      { tipo: 'criacao' },
      { tipo: 'responsavel', de: null, para: { id: ana.id, nome: 'Ana Ficticia' } },
      { tipo: 'status', de: 'aberta', para: 'em_andamento' },
    ]);
    // O criador passa a ver o responsável.
    expect(ok(await chamar('GET', `/pedidos/${pedido.id}`, pedro.token)).responsavel?.id).toBe(
      ana.id,
    );
  });

  it('outra pessoa que acompanha assume no lugar: só o evento do responsável', async () => {
    const pedido = await pedir();
    ok(await chamar('POST', `/pedidos/${pedido.id}/assumir`, ana.token));
    const outra = await pessoa('olga@exemplo.com', 'Olga Ficticia', { roma: ACOMPANHA });
    ok(await chamar('POST', `/pedidos/${pedido.id}/assumir`, outra.token));
    const eventos = await historico(pedido.id);
    expect(eventos.at(-1)?.dados).toEqual({
      tipo: 'responsavel',
      de: { id: ana.id, nome: 'Ana Ficticia' },
      para: { id: outra.id, nome: 'Olga Ficticia' },
    });
    expect(eventos).toHaveLength(4);
  });

  it('exige compras.acompanhar e recusa pedido terminado', async () => {
    const pedido = await pedir();
    esperarErro(
      await chamar('POST', `/pedidos/${pedido.id}/assumir`, pedro.token),
      403,
      'permissao_proibida',
    );
    ok(await chamar('PATCH', `/pedidos/${pedido.id}/status`, ana.token, { status: 'cancelada' }));
    esperarErro(
      await chamar('POST', `/pedidos/${pedido.id}/assumir`, ana.token),
      409,
      'pedido_encerrado',
    );
  });
});

describe('status', () => {
  it('quem acompanha muda para qualquer status; o mesmo status não gera evento', async () => {
    const pedido = await pedir();
    ok(await chamar('PATCH', `/pedidos/${pedido.id}/status`, ana.token, { status: 'concluida' }));
    ok(await chamar('PATCH', `/pedidos/${pedido.id}/status`, ana.token, { status: 'concluida' }));
    expect((await historico(pedido.id)).map((e) => e.dados)).toEqual([
      { tipo: 'criacao' },
      { tipo: 'status', de: 'aberta', para: 'concluida' },
    ]);
  });

  it('o criador só cancela o próprio pedido enquanto está aberto', async () => {
    const pedido = await pedir();
    esperarErro(
      await chamar('PATCH', `/pedidos/${pedido.id}/status`, pedro.token, { status: 'concluida' }),
      403,
      'permissao_proibida',
    );
    expect(
      ok(
        await chamar('PATCH', `/pedidos/${pedido.id}/status`, pedro.token, {
          status: 'cancelada',
        }),
      ).status,
    ).toBe('cancelada');

    const assumido = await pedir();
    ok(await chamar('POST', `/pedidos/${assumido.id}/assumir`, ana.token));
    esperarErro(
      await chamar('PATCH', `/pedidos/${assumido.id}/status`, pedro.token, {
        status: 'cancelada',
      }),
      403,
      'permissao_proibida',
    );
  });

  it('recusa status fora da lista e pedido de outra pessoa', async () => {
    const pedido = await pedir();
    esperarErro(
      await chamar('PATCH', `/pedidos/${pedido.id}/status`, ana.token, { status: 'pausada' }),
      400,
      'requisicao_invalida',
    );
    esperarErro(
      await chamar('PATCH', `/pedidos/${pedido.id}/status`, paula.token, { status: 'cancelada' }),
      404,
      'pedido_nao_encontrado',
    );
  });
});

describe('edição', () => {
  it('o criador edita insumo, quantidade e observação; cada mudança vai para o histórico', async () => {
    const pedido = await pedir();
    const editado = ok(
      await chamar('PATCH', `/pedidos/${pedido.id}`, pedro.token, {
        insumoId: tpp2,
        quantidade: 12.5,
        observacao: 'entregar na expedição',
      }),
    );
    expect(editado).toMatchObject({
      insumo: { id: tpp2 },
      quantidade: 12.5,
      observacao: 'entregar na expedição',
    });
    // Nada muda de verdade: sem evento.
    ok(await chamar('PATCH', `/pedidos/${pedido.id}`, pedro.token, { quantidade: 12.5 }));
    ok(await chamar('PATCH', `/pedidos/${pedido.id}`, pedro.token, { observacao: '' }));
    expect((await historico(pedido.id)).map((e) => e.dados)).toEqual([
      { tipo: 'criacao' },
      {
        tipo: 'edicao',
        insumo: { de: 'TPP001 — Tinta Ficticia', para: 'TPP002 — Fita Ficticia' },
        quantidade: { de: 10, para: 12.5 },
        observacao: { de: null, para: 'entregar na expedição' },
      },
      { tipo: 'edicao', observacao: { de: 'entregar na expedição', para: null } },
    ]);
  });

  it('quem acompanha edita o pedido de outra pessoa enquanto está em andamento', async () => {
    const pedido = await pedir();
    ok(await chamar('POST', `/pedidos/${pedido.id}/assumir`, ana.token));
    expect(
      ok(await chamar('PATCH', `/pedidos/${pedido.id}`, ana.token, { quantidade: 3 })).quantidade,
    ).toBe(3);
  });

  it('recusa pedido terminado, insumo inválido, corpo vazio e pedido fora do alcance', async () => {
    const pedido = await pedir();
    esperarErro(
      await chamar('PATCH', `/pedidos/${pedido.id}`, pedro.token, { insumoId: caixa }),
      400,
      'insumo_invalido',
    );
    esperarErro(
      await chamar('PATCH', `/pedidos/${pedido.id}`, pedro.token, {}),
      400,
      'requisicao_invalida',
    );
    esperarErro(
      await chamar('PATCH', `/pedidos/${pedido.id}`, paula.token, { quantidade: 2 }),
      404,
      'pedido_nao_encontrado',
    );
    ok(await chamar('PATCH', `/pedidos/${pedido.id}/status`, ana.token, { status: 'concluida' }));
    esperarErro(
      await chamar('PATCH', `/pedidos/${pedido.id}`, ana.token, { quantidade: 2 }),
      409,
      'pedido_encerrado',
    );
  });

  it('o criador que perdeu compras.pedir não edita mais', async () => {
    const pedido = await pedir();
    // Tira a subpermissão direto no banco; vale na próxima requisição.
    await db
      .update(usuarioEmpresas)
      .set({ permissoes: ['compras'] })
      .where(eq(usuarioEmpresas.usuarioId, pedro.id));
    esperarErro(
      await chamar('PATCH', `/pedidos/${pedido.id}`, pedro.token, { quantidade: 2 }),
      403,
      'permissao_proibida',
    );
  });
});

describe('módulo', () => {
  it('não existe na empresa sem sincronização do Bling', async () => {
    esperarErro(
      await chamar('GET', '/pedidos', ana.token, undefined, 'aba'),
      404,
      'compras_indisponivel',
    );
  });

  it('exige o módulo compras e a empresa no token', async () => {
    esperarErro(await chamar('GET', '/pedidos', semCompras.token), 403, 'permissao_proibida');
    esperarErro(
      await chamar('GET', '/pedidos', pedro.token, undefined, 'aba'),
      403,
      'empresa_proibida',
    );
  });
});
