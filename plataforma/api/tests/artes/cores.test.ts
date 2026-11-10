import {
  EsquemaErro,
  EsquemaOpcao,
  EsquemaRespostaEntrar,
  type Perfil,
} from '@plataforma/contratos';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { criarUsuario } from '../../src/usuarios/servico.js';
import { criarAppTeste } from '../helpers/app.js';
import { criarBancoTeste, limparTabelas } from '../helpers/banco.js';

const { db, fechar } = criarBancoTeste();
afterAll(() => fechar());

const SENHA = 'senha-ficticia-123';

let app: FastifyInstance;

async function entrar(email: string, perfil: Perfil): Promise<string> {
  await criarUsuario(db, { email, nome: 'Pessoa Teste', perfil, senha: SENHA, empresas: ['aba'] });
  const resposta = await app.inject({
    method: 'POST',
    url: '/v1/auth/entrar',
    payload: { email, senha: SENHA, origem: 'web' },
  });
  return EsquemaRespostaEntrar.parse(resposta.json()).acesso;
}

const criar = (nome: unknown, token: string | null) =>
  app.inject({
    method: 'POST',
    url: '/v1/cores',
    payload: { nome },
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });

const listar = async (token: string) => {
  const resposta = await app.inject({
    method: 'GET',
    url: '/v1/cores',
    headers: { authorization: `Bearer ${token}` },
  });
  return z.array(EsquemaOpcao).parse(resposta.json());
};

function esperarErro(resposta: LightMyRequestResponse, status: number, codigo: string) {
  expect(resposta.statusCode).toBe(status);
  expect(EsquemaErro.parse(resposta.json()).erro.codigo).toBe(codigo);
}

beforeEach(async () => {
  await limparTabelas(db);
  ({ app } = criarAppTeste(db));
});
afterEach(() => app.close());

describe('POST /v1/cores', () => {
  it('admin cria uma cor, sem os espaços em volta, e ela entra na lista', async () => {
    const acesso = await entrar('admin@exemplo.com', 'admin');
    const resposta = await criar('  Pantone   485 ', acesso);

    expect(resposta.statusCode).toBe(201);
    const cor = EsquemaOpcao.parse(resposta.json());
    expect(cor.nome).toBe('Pantone 485');
    expect((await listar(acesso)).map((c) => c.nome)).toEqual(['4x0', '4x4', 'Pantone 485']);
  });

  it('arte-finalista também cria', async () => {
    const acesso = await entrar('arte@exemplo.com', 'arte_finalista');
    expect((await criar('1x0', acesso)).statusCode).toBe(201);
  });

  it('exige login', async () => {
    esperarErro(await criar('1x0', null), 401, 'nao_autenticado');
  });

  it('recusa nome vazio ou longo com a mensagem do contrato', async () => {
    const acesso = await entrar('admin@exemplo.com', 'admin');
    const vazio = await criar('   ', acesso);
    esperarErro(vazio, 422, 'validacao');
    expect(EsquemaErro.parse(vazio.json()).erro.mensagem).toBe('Informe o nome da cor.');
    esperarErro(await criar('a'.repeat(31), acesso), 422, 'validacao');
  });

  it('recusa corpo sem nome', async () => {
    const acesso = await entrar('admin@exemplo.com', 'admin');
    esperarErro(await criar(undefined, acesso), 400, 'requisicao_invalida');
  });

  it('recusa cor repetida sem diferenciar maiúsculas nem acentos', async () => {
    const acesso = await entrar('admin@exemplo.com', 'admin');
    const repetida = await criar('4X4', acesso);
    esperarErro(repetida, 409, 'cor_existente');
    expect(EsquemaErro.parse(repetida.json()).erro.mensagem).toBe("A cor '4X4' já existe.");

    expect((await criar('Ciano Médio', acesso)).statusCode).toBe(201);
    esperarErro(await criar('ciano medio', acesso), 409, 'cor_existente');
    expect(await listar(acesso)).toHaveLength(3);
  });
});
