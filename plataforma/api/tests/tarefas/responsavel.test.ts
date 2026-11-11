import {
  EsquemaErro,
  EsquemaRespostaEntrar,
  EsquemaResponsavelAutomatico,
  EsquemaTarefa,
  type Perfil,
} from '@plataforma/contratos';
import { eq } from 'drizzle-orm';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { gerarCnpj } from '../../src/cli/semear-dev.js';
import { clientes, empresas, produtos, tarefasArteHistorico } from '../../src/db/esquema.js';
import {
  definirResponsavelAutomatico,
  resolverResponsavelAutomatico,
} from '../../src/tarefas/responsavel.js';
import { criarTarefa } from '../../src/tarefas/servico.js';
import { criarUsuario, desativar } from '../../src/usuarios/servico.js';
import { criarAppTeste } from '../helpers/app.js';
import { criarBancoTeste, limparTabelas } from '../helpers/banco.js';

// Dados sintéticos.
const { db, fechar } = criarBancoTeste();
afterAll(() => fechar());

const SENHA = 'senha-ficticia-123';
let app: FastifyInstance;
let aba: string;

async function usuario(email: string, perfil: Perfil, empresasDoUsuario = ['aba']) {
  return criarUsuario(db, {
    email,
    nome: email,
    perfil,
    senha: SENHA,
    empresas: empresasDoUsuario,
  });
}

async function entrar(email: string) {
  const resposta = await app.inject({
    method: 'POST',
    url: '/v1/auth/entrar',
    payload: { email, senha: SENHA, origem: 'web' },
  });
  return EsquemaRespostaEntrar.parse(resposta.json()).acesso;
}

const auth = (token: string) => ({ authorization: `Bearer ${token}` });
const URL_RESPONSAVEL = '/v1/empresas/aba/tarefas/responsavel-automatico';

function esperarErro(resposta: LightMyRequestResponse, status: number, codigo: string) {
  expect(resposta.statusCode).toBe(status);
  expect(EsquemaErro.parse(resposta.json()).erro.codigo).toBe(codigo);
}

beforeEach(async () => {
  await limparTabelas(db);
  ({ app } = criarAppTeste(db));
  aba = (await db.select().from(empresas).where(eq(empresas.slug, 'aba')))[0]!.id;
});
afterEach(() => app.close());

describe('resolverResponsavelAutomatico', () => {
  it('sem arte finalista: ninguém; com uma só: ela', async () => {
    await usuario('adm@exemplo.com', 'admin');
    expect(await resolverResponsavelAutomatico(db, aba)).toBeNull();
    const ana = await usuario('ana@exemplo.com', 'arte_finalista');
    await usuario('roma@exemplo.com', 'arte_finalista', ['roma']);
    expect(await resolverResponsavelAutomatico(db, aba)).toBe(ana.id);
  });

  it('com duas e nenhuma configurada: ninguém; configurada: ela', async () => {
    await usuario('ana@exemplo.com', 'arte_finalista');
    const bia = await usuario('bia@exemplo.com', 'arte_finalista');
    expect(await resolverResponsavelAutomatico(db, aba)).toBeNull();
    await definirResponsavelAutomatico(db, aba, bia.id);
    expect(await resolverResponsavelAutomatico(db, aba)).toBe(bia.id);
  });

  it('a configurada desativada deixa de valer (volta à regra da única)', async () => {
    const ana = await usuario('ana@exemplo.com', 'arte_finalista');
    const bia = await usuario('bia@exemplo.com', 'arte_finalista');
    await definirResponsavelAutomatico(db, aba, bia.id);
    await desativar(db, 'bia@exemplo.com');
    expect(await resolverResponsavelAutomatico(db, aba)).toBe(ana.id);
  });
});

describe('rotas do responsável automático', () => {
  it('o admin vê as elegíveis, escolhe e limpa', async () => {
    await usuario('adm@exemplo.com', 'admin');
    const ana = await usuario('ana@exemplo.com', 'arte_finalista');
    const token = await entrar('adm@exemplo.com');

    const inicial = EsquemaResponsavelAutomatico.parse(
      (await app.inject({ method: 'GET', url: URL_RESPONSAVEL, headers: auth(token) })).json(),
    );
    expect(inicial).toEqual({ responsavelId: null, elegiveis: [{ id: ana.id, nome: ana.nome }] });

    const escolhido = await app.inject({
      method: 'PUT',
      url: URL_RESPONSAVEL,
      headers: auth(token),
      payload: { responsavelId: ana.id },
    });
    expect(EsquemaResponsavelAutomatico.parse(escolhido.json()).responsavelId).toBe(ana.id);

    const limpo = await app.inject({
      method: 'PUT',
      url: URL_RESPONSAVEL,
      headers: auth(token),
      payload: { responsavelId: null },
    });
    expect(EsquemaResponsavelAutomatico.parse(limpo.json()).responsavelId).toBeNull();
  });

  it('inelegível (admin, de outra empresa ou inexistente): 400', async () => {
    const adm = await usuario('adm@exemplo.com', 'admin');
    const deRoma = await usuario('roma@exemplo.com', 'arte_finalista', ['roma']);
    const token = await entrar('adm@exemplo.com');
    for (const responsavelId of [adm.id, deRoma.id, crypto.randomUUID()]) {
      const resposta = await app.inject({
        method: 'PUT',
        url: URL_RESPONSAVEL,
        headers: auth(token),
        payload: { responsavelId },
      });
      esperarErro(resposta, 400, 'responsavel_invalido');
    }
  });

  it('arte finalista: 403', async () => {
    await usuario('ana@exemplo.com', 'arte_finalista');
    const token = await entrar('ana@exemplo.com');
    esperarErro(
      await app.inject({ method: 'GET', url: URL_RESPONSAVEL, headers: auth(token) }),
      403,
      'permissao_proibida',
    );
  });
});

describe('tarefa automática', () => {
  it('nasce com o responsável dado, origem e pedido; o primeiro evento é do sistema', async () => {
    const ana = await usuario('ana@exemplo.com', 'arte_finalista');
    const [cliente] = await db
      .insert(clientes)
      .values({ empresaId: aba, razaoSocial: 'Cliente Ficticio Ltda', cnpj: gerarCnpj(21) })
      .returning();
    const [produto] = await db
      .insert(produtos)
      .values({ empresaId: aba, nome: 'Caixa Ficticia' })
      .returning();
    const tarefa = await criarTarefa(db, {
      empresaId: aba,
      clienteId: cliente!.id,
      produtoId: produto!.id,
      usuarioId: null,
      responsavelId: ana.id,
      origem: 'bling_pedido',
      pedidoNumero: '9001',
    });
    expect(tarefa).toMatchObject({
      responsavel: { id: ana.id },
      origem: 'bling_pedido',
      pedidoNumero: '9001',
    });
    const [evento] = await db
      .select()
      .from(tarefasArteHistorico)
      .where(eq(tarefasArteHistorico.tarefaId, tarefa.id));
    expect(evento?.autorId).toBeNull();

    const token = await entrar('ana@exemplo.com');
    const lista = z
      .array(EsquemaTarefa)
      .parse(
        (
          await app.inject({ method: 'GET', url: '/v1/empresas/aba/tarefas', headers: auth(token) })
        ).json(),
      );
    expect(lista.map((t) => t.id)).toEqual([tarefa.id]);
  });
});
