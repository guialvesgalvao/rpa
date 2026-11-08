import {
  EsquemaErro,
  EsquemaEu,
  EsquemaRespostaEntrar,
  EsquemaTokens,
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

describe('troca de senha', () => {
  const NOVA = 'senha-nova-456789';

  async function entrarCom(email: string, senha: string) {
    const resposta = await app.inject({
      method: 'POST',
      url: '/v1/auth/entrar',
      payload: { email, senha, origem: 'desktop' },
    });
    return resposta;
  }

  const trocar = (token: string, corpo: Record<string, unknown>) =>
    app.inject({ method: 'POST', url: '/v1/eu/senha', headers: auth(token), payload: corpo });

  const renovar = (renovacao: string) =>
    app.inject({ method: 'POST', url: '/v1/auth/renovar', payload: { renovacao } });

  it('usuário criado pela tela entra com deveTrocarSenha; depois da troca, false', async () => {
    const admin = await entrar('adm@exemplo.com', 'admin', ['aba']);
    const inicial = 'senha-inicial-123';
    await criar(admin, { ...novo('nova@exemplo.com', ['aba']), senha: inicial });

    const login = EsquemaRespostaEntrar.parse(
      (await entrarCom('nova@exemplo.com', inicial)).json(),
    );
    expect(login.eu.deveTrocarSenha).toBe(true);
    const eu = await app.inject({ method: 'GET', url: '/v1/eu', headers: auth(login.acesso) });
    expect(EsquemaEu.parse(eu.json()).deveTrocarSenha).toBe(true);

    const resposta = await trocar(login.acesso, { senhaAtual: inicial, novaSenha: NOVA });
    expect(resposta.statusCode).toBe(204);
    const depois = await app.inject({ method: 'GET', url: '/v1/eu', headers: auth(login.acesso) });
    expect(EsquemaEu.parse(depois.json()).deveTrocarSenha).toBe(false);
    expect((await entrarCom('nova@exemplo.com', inicial)).statusCode).toBe(401);
    expect((await entrarCom('nova@exemplo.com', NOVA)).statusCode).toBe(200);
  });

  it('usuário da CLI entra sem pedido de troca', async () => {
    await criarUsuario(db, {
      email: 'cli@exemplo.com',
      nome: 'Cli Ficticio',
      perfil: 'admin',
      senha: SENHA,
      empresas: ['aba'],
    });
    const login = EsquemaRespostaEntrar.parse((await entrarCom('cli@exemplo.com', SENHA)).json());
    expect(login.eu.deveTrocarSenha).toBe(false);
  });

  it('senha atual errada, nova curta ou igual: 400, e nada muda', async () => {
    const token = await entrar('ana@exemplo.com', 'arte_finalista', ['aba']);
    esperarErro(
      await trocar(token, { senhaAtual: 'errada-errada', novaSenha: NOVA }),
      400,
      'senha_atual_incorreta',
    );
    esperarErro(
      await trocar(token, { senhaAtual: SENHA, novaSenha: 'curta' }),
      400,
      'requisicao_invalida',
    );
    esperarErro(
      await trocar(token, { senhaAtual: SENHA, novaSenha: SENHA }),
      400,
      'senha_repetida',
    );
    expect((await entrarCom('ana@exemplo.com', SENHA)).statusCode).toBe(200);
  });

  it('revoga as outras sessões e mantém a de quem trocou', async () => {
    await criarUsuario(db, {
      email: 'ana@exemplo.com',
      nome: 'Ana Ficticia',
      perfil: 'arte_finalista',
      senha: SENHA,
      empresas: ['aba'],
    });
    const atual = EsquemaRespostaEntrar.parse((await entrarCom('ana@exemplo.com', SENHA)).json());
    const outra = EsquemaRespostaEntrar.parse((await entrarCom('ana@exemplo.com', SENHA)).json());

    const resposta = await trocar(atual.acesso, {
      senhaAtual: SENHA,
      novaSenha: NOVA,
      renovacao: atual.renovacao,
    });
    expect(resposta.statusCode).toBe(204);
    esperarErro(await renovar(outra.renovacao), 401, 'sessao_invalida');
    const renovada = await renovar(atual.renovacao);
    expect(renovada.statusCode).toBe(200);
    EsquemaTokens.parse(renovada.json());
  });

  it('sem a sessão no corpo, revoga todas', async () => {
    await criarUsuario(db, {
      email: 'ana@exemplo.com',
      nome: 'Ana Ficticia',
      perfil: 'arte_finalista',
      senha: SENHA,
      empresas: ['aba'],
    });
    const login = EsquemaRespostaEntrar.parse((await entrarCom('ana@exemplo.com', SENHA)).json());
    expect((await trocar(login.acesso, { senhaAtual: SENHA, novaSenha: NOVA })).statusCode).toBe(
      204,
    );
    esperarErro(await renovar(login.renovacao), 401, 'sessao_invalida');
  });

  it('limita as tentativas por usuário: 429', async () => {
    const token = await entrar('ana@exemplo.com', 'arte_finalista', ['aba']);
    for (let i = 0; i < 5; i++) {
      esperarErro(
        await trocar(token, { senhaAtual: 'errada-errada', novaSenha: NOVA }),
        400,
        'senha_atual_incorreta',
      );
    }
    esperarErro(
      await trocar(token, { senhaAtual: SENHA, novaSenha: NOVA }),
      429,
      'muitas_tentativas',
    );
  });

  it('sem login: 401', async () => {
    const resposta = await app.inject({
      method: 'POST',
      url: '/v1/eu/senha',
      payload: { senhaAtual: SENHA, novaSenha: NOVA },
    });
    esperarErro(resposta, 401, 'nao_autenticado');
  });
});
