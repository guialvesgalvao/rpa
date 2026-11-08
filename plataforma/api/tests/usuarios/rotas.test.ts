import {
  EsquemaErro,
  EsquemaRespostaEntrar,
  EsquemaUsuarioResumo,
  type Perfil,
} from '@plataforma/contratos';
import { eq } from 'drizzle-orm';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { usuarios } from '../../src/db/esquema.js';
import { criarUsuario, definirEmpresas } from '../../src/usuarios/servico.js';
import { criarAppTeste } from '../helpers/app.js';
import { criarBancoTeste, limparTabelas } from '../helpers/banco.js';

// Dados sintéticos.
const { db, fechar } = criarBancoTeste();
afterAll(() => fechar());

const SENHA = 'senha-ficticia-123';

let app: FastifyInstance;

async function entrar(email: string, perfil: Perfil, empresas: string[]) {
  await criarUsuario(db, { email, nome: `Nome ${email}`, perfil, senha: SENHA, empresas });
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
});
afterEach(() => app.close());

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

const criar = (token: string, corpo: Record<string, unknown>) =>
  app.inject({ method: 'POST', url: '/v1/usuarios', headers: auth(token), payload: corpo });

const listar = (token: string) =>
  app.inject({ method: 'GET', url: '/v1/usuarios', headers: auth(token) });

const novo = (email: string, empresas: string[], perfil: Perfil = 'arte_finalista') => ({
  nome: 'Usuario Ficticio',
  email,
  perfil,
  empresas,
  senha: 'senha-inicial-123',
});

function esperarErro(resposta: LightMyRequestResponse, status: number, codigo: string) {
  expect(resposta.statusCode).toBe(status);
  expect(EsquemaErro.parse(resposta.json()).erro.codigo).toBe(codigo);
}

describe('POST /v1/usuarios', () => {
  it('admin só da ABA cria só na ABA; Roma ou as duas: 403', async () => {
    const token = await entrar('adm-aba@exemplo.com', 'admin', ['aba']);
    const resposta = await criar(token, novo('nova@exemplo.com', ['aba']));
    expect(resposta.statusCode).toBe(201);
    expect(EsquemaUsuarioResumo.parse(resposta.json())).toMatchObject({
      email: 'nova@exemplo.com',
      perfil: 'arte_finalista',
      empresas: ['aba'],
      ativo: true,
    });
    esperarErro(await criar(token, novo('r@exemplo.com', ['roma'])), 403, 'empresa_proibida');
    esperarErro(
      await criar(token, novo('ar@exemplo.com', ['aba', 'roma'])),
      403,
      'empresa_proibida',
    );
  });

  it('admin só da Roma cria só na Roma', async () => {
    const token = await entrar('adm-roma@exemplo.com', 'admin', ['roma']);
    expect((await criar(token, novo('r@exemplo.com', ['roma']))).statusCode).toBe(201);
    esperarErro(await criar(token, novo('a@exemplo.com', ['aba'])), 403, 'empresa_proibida');
  });

  it('admin da ABA e da Roma cria ABA, Roma ou as duas, inclusive outro admin', async () => {
    const token = await entrar('adm@exemplo.com', 'admin', ['aba', 'roma']);
    const casos: [string, string[]][] = [
      ['a@exemplo.com', ['aba']],
      ['r@exemplo.com', ['roma']],
      ['ar@exemplo.com', ['roma', 'aba']],
    ];
    for (const [email, empresas] of casos) {
      const resposta = await criar(token, novo(email, empresas, 'admin'));
      expect(resposta.statusCode).toBe(201);
      expect(EsquemaUsuarioResumo.parse(resposta.json()).empresas).toEqual([...empresas].sort());
    }
  });

  it('usa as empresas do banco, não as do token', async () => {
    const token = await entrar('adm@exemplo.com', 'admin', ['aba', 'roma']);
    await definirEmpresas(db, 'adm@exemplo.com', ['aba']);
    esperarErro(await criar(token, novo('r@exemplo.com', ['roma'])), 403, 'empresa_proibida');
  });

  it('nasce pedindo a troca de senha e a resposta nunca traz o hash', async () => {
    const token = await entrar('adm@exemplo.com', 'admin', ['aba']);
    const resposta = await criar(token, novo('nova@exemplo.com', ['aba']));
    expect(resposta.statusCode).toBe(201);
    expect(resposta.body).not.toMatch(/hash|scrypt|senha/i);
    const [linha] = await db.select().from(usuarios).where(eq(usuarios.email, 'nova@exemplo.com'));
    expect(linha?.deveTrocarSenha).toBe(true);
  });

  it('a CLI (serviço sem a opção) continua criando sem pedir a troca', async () => {
    await criarUsuario(db, {
      email: 'cli@exemplo.com',
      nome: 'Cli Ficticio',
      perfil: 'admin',
      senha: SENHA,
      empresas: ['aba'],
    });
    const [linha] = await db.select().from(usuarios).where(eq(usuarios.email, 'cli@exemplo.com'));
    expect(linha?.deveTrocarSenha).toBe(false);
  });

  it('e-mail repetido: 409; dado inválido: 400', async () => {
    const token = await entrar('adm@exemplo.com', 'admin', ['aba']);
    expect((await criar(token, novo('nova@exemplo.com', ['aba']))).statusCode).toBe(201);
    esperarErro(await criar(token, novo('NOVA@exemplo.com', ['aba'])), 409, 'email_em_uso');
    esperarErro(
      await criar(token, { ...novo('x@exemplo.com', ['aba']), senha: 'curta' }),
      400,
      'requisicao_invalida',
    );
  });

  it('arte finalista: 403; sem login: 401', async () => {
    const token = await entrar('ana@exemplo.com', 'arte_finalista', ['aba']);
    esperarErro(await criar(token, novo('x@exemplo.com', ['aba'])), 403, 'perfil_proibido');
    esperarErro(await listar(token), 403, 'perfil_proibido');
    const semLogin = await app.inject({ method: 'GET', url: '/v1/usuarios' });
    esperarErro(semLogin, 401, 'nao_autenticado');
  });
});

describe('GET /v1/usuarios', () => {
  it('lista só quem tem todas as empresas dentro das do admin, sem hash', async () => {
    const token = await entrar('adm-aba@exemplo.com', 'admin', ['aba']);
    const outros: [string, Perfil, string[]][] = [
      ['so-aba@exemplo.com', 'arte_finalista', ['aba']],
      ['aba-roma@exemplo.com', 'arte_finalista', ['aba', 'roma']],
      ['so-roma@exemplo.com', 'admin', ['roma']],
    ];
    for (const [email, perfil, empresas] of outros) {
      await criarUsuario(db, { email, nome: 'Outro Ficticio', perfil, senha: SENHA, empresas });
    }
    const resposta = await listar(token);
    expect(resposta.statusCode).toBe(200);
    const lista = z.array(EsquemaUsuarioResumo).parse(resposta.json());
    expect(lista.map((u) => u.email)).toEqual(['adm-aba@exemplo.com', 'so-aba@exemplo.com']);
    expect(resposta.body).not.toMatch(/hash/i);
  });
});
