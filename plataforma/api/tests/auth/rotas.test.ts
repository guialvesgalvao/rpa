import {
  EsquemaErro,
  EsquemaEu,
  EsquemaRespostaEntrar,
  EsquemaTokens,
  type Origem,
} from '@plataforma/contratos';
import { eq } from 'drizzle-orm';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { decodeJwt } from 'jose';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { JANELA_TENTATIVAS_MS } from '../../src/auth/limite.js';
import { DURACAO_WEB_MS, hashDoToken, JANELA_CORRIDA_MS } from '../../src/auth/sessoes.js';
import { criarTokens, DURACAO_ACESSO_MS } from '../../src/auth/tokens.js';
import { sessoes, usuarioEmpresas, usuarios } from '../../src/db/esquema.js';
import {
  criarUsuario,
  definirEmpresas,
  desativar,
  type NovoUsuario,
} from '../../src/usuarios/servico.js';
import { criarAppTeste, type RelogioFalso, SEGREDO_TESTE } from '../helpers/app.js';
import { criarBancoTeste, limparTabelas } from '../helpers/banco.js';

const { db, fechar } = criarBancoTeste();
afterAll(() => fechar());

const SENHA = 'senha-ficticia-123';
const EMAIL = 'ana@exemplo.com';
const DIA_MS = 24 * 60 * 60 * 1000;

let app: FastifyInstance;
let relogio: RelogioFalso;

beforeEach(async () => {
  await limparTabelas(db);
  ({ app, relogio } = criarAppTeste(db));
});
afterEach(() => app.close());

const cadastrar = (extra: Partial<NovoUsuario> = {}) =>
  criarUsuario(db, {
    email: EMAIL,
    nome: 'Ana Teste',
    perfil: 'arte_finalista',
    senha: SENHA,
    empresas: ['aba'],
    ...extra,
  });

const entrar = (corpo: object) =>
  app.inject({ method: 'POST', url: '/v1/auth/entrar', payload: corpo });
const renovar = (renovacao: string) =>
  app.inject({ method: 'POST', url: '/v1/auth/renovar', payload: { renovacao } });
const sair = (renovacao: string) =>
  app.inject({ method: 'POST', url: '/v1/auth/sair', payload: { renovacao } });
const autorizacao = (acesso: string) => ({ authorization: `Bearer ${acesso}` });
const eu = (headers: Record<string, string> = {}) =>
  app.inject({ method: 'GET', url: '/v1/eu', headers });

async function login(origem: Origem = 'web', email = EMAIL) {
  const resposta = await entrar({ email, senha: SENHA, origem });
  expect(resposta.statusCode).toBe(200);
  return EsquemaRespostaEntrar.parse(resposta.json());
}

async function renovado(renovacao: string) {
  const resposta = await renovar(renovacao);
  expect(resposta.statusCode).toBe(200);
  return EsquemaTokens.parse(resposta.json());
}

function esperarErro(resposta: LightMyRequestResponse, status: number, codigo: string) {
  expect(resposta.statusCode).toBe(status);
  const { erro } = EsquemaErro.parse(resposta.json());
  expect(erro.codigo).toBe(codigo);
  return erro;
}

async function sessoesGravadas() {
  return db.select().from(sessoes);
}

describe('POST /v1/auth/entrar', () => {
  it('login web: tokens, eu e sessão que expira em 30 dias', async () => {
    const usuario = await cadastrar({ empresas: ['roma', 'aba'] });

    const corpo = await login('web', '  ANA@Exemplo.com ');

    expect(corpo.eu).toEqual({
      id: usuario.id,
      nome: 'Ana Teste',
      email: EMAIL,
      perfil: 'arte_finalista',
      empresas: [
        { slug: 'aba', nome: 'ABA Embalagens' },
        { slug: 'roma', nome: 'Roma Embalagens' },
      ],
    });
    expect(new Date(corpo.expiraEm)).toEqual(
      new Date(relogio.agora().getTime() + DURACAO_ACESSO_MS),
    );
    expect(decodeJwt(corpo.acesso)).toMatchObject({
      sub: usuario.id,
      perfil: 'arte_finalista',
      empresas: ['aba', 'roma'],
    });

    const [sessao] = await sessoesGravadas();
    expect(sessao).toMatchObject({
      usuarioId: usuario.id,
      origem: 'web',
      hashAtual: hashDoToken(corpo.renovacao),
      expiraEm: new Date(relogio.agora().getTime() + DURACAO_WEB_MS),
      revogadaEm: null,
    });
    expect(Buffer.from(corpo.renovacao, 'base64url')).toHaveLength(32);
    expect(JSON.stringify(sessao)).not.toContain(corpo.renovacao);
  });

  it('login desktop: sessão sem expiração', async () => {
    await cadastrar();
    await login('desktop');

    const [sessao] = await sessoesGravadas();
    expect(sessao).toMatchObject({ origem: 'desktop', expiraEm: null });
  });

  it('senha errada, e-mail inexistente e usuário inativo têm a mesma resposta 401', async () => {
    await cadastrar();
    await cadastrar({ email: 'inativa@exemplo.com' });
    await desativar(db, 'inativa@exemplo.com');

    const respostas = [
      await entrar({ email: EMAIL, senha: `${SENHA}x`, origem: 'web' }),
      await entrar({ email: 'ninguem@exemplo.com', senha: SENHA, origem: 'web' }),
      await entrar({ email: 'inativa@exemplo.com', senha: SENHA, origem: 'web' }),
    ];

    for (const resposta of respostas) {
      expect(esperarErro(resposta, 401, 'credenciais_invalidas').mensagem).toBe(
        'E-mail ou senha inválidos.',
      );
    }
    expect(new Set(respostas.map((r) => r.body)).size).toBe(1);
    expect(await sessoesGravadas()).toEqual([]);
  });

  it('usuário sem empresa: 403 só com a senha certa', async () => {
    const usuario = await cadastrar();
    await db.delete(usuarioEmpresas).where(eq(usuarioEmpresas.usuarioId, usuario.id));

    esperarErro(
      await entrar({ email: EMAIL, senha: 'errada-123456', origem: 'web' }),
      401,
      'credenciais_invalidas',
    );
    esperarErro(await entrar({ email: EMAIL, senha: SENHA, origem: 'web' }), 403, 'sem_empresa');
    expect(await sessoesGravadas()).toEqual([]);
  });

  it('corpo inválido ou JSON malformado: 400 no formato do contrato', async () => {
    esperarErro(
      await entrar({ email: EMAIL, senha: SENHA, origem: 'celular' }),
      400,
      'requisicao_invalida',
    );
    esperarErro(
      await entrar({ email: 'ana', senha: SENHA, origem: 'web' }),
      400,
      'requisicao_invalida',
    );
    const malformado = await app.inject({
      method: 'POST',
      url: '/v1/auth/entrar',
      headers: { 'content-type': 'application/json' },
      payload: '{"email":',
    });
    esperarErro(malformado, 400, 'requisicao_invalida');
  });

  it('limite: 5 tentativas por e-mail em 15 min, depois nem a senha certa entra', async () => {
    await cadastrar();
    await cadastrar({ email: 'bia@exemplo.com' });

    for (let i = 0; i < 5; i++) {
      esperarErro(
        await entrar({ email: EMAIL, senha: `errada-${i}-123`, origem: 'web' }),
        401,
        'credenciais_invalidas',
      );
    }
    const bloqueada = await entrar({ email: EMAIL, senha: SENHA, origem: 'web' });
    expect(esperarErro(bloqueada, 401, 'credenciais_invalidas').mensagem).toBe(
      'E-mail ou senha inválidos.',
    );
    await login('web', 'bia@exemplo.com');

    relogio.avancar(JANELA_TENTATIVAS_MS);
    await login('web');
  });

  it('limite: o login certo zera a conta de tentativas', async () => {
    await cadastrar();
    for (let i = 0; i < 4; i++) {
      await entrar({ email: EMAIL, senha: `errada-${i}-123`, origem: 'web' });
    }
    await login('web');
    // Sem zerar, esta seria a 6ª tentativa na janela, já bloqueada.
    await login('web');
  });
});

describe('POST /v1/auth/renovar', () => {
  it('rotaciona: novo par de tokens, e o atual vira o anterior', async () => {
    await cadastrar();
    const inicial = await login('web');

    relogio.avancar(10 * 60 * 1000);
    const segundo = await renovado(inicial.renovacao);
    expect(segundo.renovacao).not.toBe(inicial.renovacao);
    expect(new Date(segundo.expiraEm)).toEqual(
      new Date(relogio.agora().getTime() + DURACAO_ACESSO_MS),
    );
    expect((await eu(autorizacao(segundo.acesso))).statusCode).toBe(200);

    const [sessao] = await sessoesGravadas();
    expect(sessao).toMatchObject({
      hashAtual: hashDoToken(segundo.renovacao),
      hashAnterior: hashDoToken(inicial.renovacao),
      rotacionadaEm: relogio.agora(),
      ultimoUsoEm: relogio.agora(),
    });

    relogio.avancar(10 * 60 * 1000);
    await renovado(segundo.renovacao);
  });

  it('corrida: o token anterior dentro de 60 s rotaciona de novo', async () => {
    await cadastrar();
    const inicial = await login('desktop');
    const primeiro = await renovado(inicial.renovacao);

    relogio.avancar(JANELA_CORRIDA_MS);
    const segundo = await renovado(inicial.renovacao);
    expect(segundo.renovacao).not.toBe(primeiro.renovacao);

    const [sessao] = await sessoesGravadas();
    expect(sessao).toMatchObject({
      hashAtual: hashDoToken(segundo.renovacao),
      hashAnterior: hashDoToken(primeiro.renovacao),
      revogadaEm: null,
    });
    // O token da primeira rotação é agora o anterior, ainda dentro da janela.
    await renovado(primeiro.renovacao);
  });

  it('corrida: duas renovações simultâneas com o mesmo token passam', async () => {
    await cadastrar();
    const inicial = await login('desktop');

    const respostas = await Promise.all([renovar(inicial.renovacao), renovar(inicial.renovacao)]);

    expect(respostas.map((r) => r.statusCode)).toEqual([200, 200]);
    const [sessao] = await sessoesGravadas();
    expect(sessao?.revogadaEm).toBeNull();
  });

  it('reuso do token anterior depois de 60 s revoga a sessão', async () => {
    await cadastrar();
    const inicial = await login('web');
    const primeiro = await renovado(inicial.renovacao);

    relogio.avancar(JANELA_CORRIDA_MS + 1);
    esperarErro(await renovar(inicial.renovacao), 401, 'sessao_invalida');

    const [sessao] = await sessoesGravadas();
    expect(sessao).toMatchObject({
      motivoRevogacao: 'reuso_detectado',
      revogadaEm: relogio.agora(),
    });
    esperarErro(await renovar(primeiro.renovacao), 401, 'sessao_invalida');
  });

  it('token desconhecido ou corpo inválido', async () => {
    esperarErro(await renovar('token-que-nao-existe'), 401, 'sessao_invalida');
    const semCorpo = await app.inject({ method: 'POST', url: '/v1/auth/renovar', payload: {} });
    esperarErro(semCorpo, 400, 'requisicao_invalida');
  });

  it('web: expira após 30 dias sem uso', async () => {
    await cadastrar();
    const { renovacao } = await login('web');

    relogio.avancar(DURACAO_WEB_MS);
    esperarErro(await renovar(renovacao), 401, 'sessao_invalida');
  });

  it('web: cada renovação empurra a expiração', async () => {
    await cadastrar();
    let { renovacao } = await login('web');

    for (let i = 0; i < 3; i++) {
      relogio.avancar(29 * DIA_MS);
      ({ renovacao } = await renovado(renovacao));
    }
    const [sessao] = await sessoesGravadas();
    expect(sessao?.expiraEm).toEqual(new Date(relogio.agora().getTime() + DURACAO_WEB_MS));
  });

  it('desktop: não expira', async () => {
    await cadastrar();
    const { renovacao } = await login('desktop');

    relogio.avancar(400 * DIA_MS);
    await renovado(renovacao);
  });

  it('usuário desativado ou sem empresa não renova', async () => {
    const ana = await cadastrar();
    await cadastrar({ email: 'bia@exemplo.com' });
    const sessaoAna = await login('desktop');
    const sessaoBia = await login('desktop', 'bia@exemplo.com');

    await db.delete(usuarioEmpresas).where(eq(usuarioEmpresas.usuarioId, ana.id));
    esperarErro(await renovar(sessaoAna.renovacao), 403, 'sem_empresa');

    await desativar(db, 'bia@exemplo.com');
    esperarErro(await renovar(sessaoBia.renovacao), 401, 'sessao_invalida');
  });
});

describe('POST /v1/auth/sair', () => {
  it('revoga a sessão e é idempotente', async () => {
    await cadastrar();
    const { renovacao } = await login('desktop');

    expect((await sair(renovacao)).statusCode).toBe(204);
    expect((await sair(renovacao)).statusCode).toBe(204);
    expect((await sair('token-que-nao-existe')).statusCode).toBe(204);

    esperarErro(await renovar(renovacao), 401, 'sessao_invalida');
    const [sessao] = await sessoesGravadas();
    expect(sessao).toMatchObject({ motivoRevogacao: 'logout', revogadaEm: relogio.agora() });
  });
});

describe('GET /v1/eu', () => {
  it('sem token ou com Authorization malformado: 401', async () => {
    esperarErro(await eu(), 401, 'nao_autenticado');
    esperarErro(await eu({ authorization: 'Basic abc' }), 401, 'nao_autenticado');
    esperarErro(await eu({ authorization: 'Bearer token-invalido' }), 401, 'token_invalido');
  });

  it('token expirado: 401 token_expirado', async () => {
    await cadastrar();
    const { acesso } = await login('web');

    relogio.avancar(DURACAO_ACESSO_MS - 1000);
    expect((await eu(autorizacao(acesso))).statusCode).toBe(200);
    relogio.avancar(1000);
    esperarErro(await eu(autorizacao(acesso)), 401, 'token_expirado');
  });

  it('token assinado com outro segredo: 401', async () => {
    const usuario = await cadastrar();
    const falso = await criarTokens(`${SEGREDO_TESTE}-outro`).emitir(
      { usuarioId: usuario.id, perfil: 'admin', empresas: ['aba', 'roma'] },
      relogio.agora(),
    );
    esperarErro(await eu(autorizacao(falso.token)), 401, 'token_invalido');
  });

  it('lê o banco, não só o token', async () => {
    await cadastrar();
    const { acesso } = await login('web');

    await db.update(usuarios).set({ nome: 'Ana Renomeada' }).where(eq(usuarios.email, EMAIL));
    await definirEmpresas(db, EMAIL, ['aba', 'roma']);

    const resposta = await eu(autorizacao(acesso));
    expect(resposta.statusCode).toBe(200);
    const corpo = EsquemaEu.parse(resposta.json());
    expect(corpo.nome).toBe('Ana Renomeada');
    expect(corpo.empresas.map((e) => e.slug)).toEqual(['aba', 'roma']);
    expect(resposta.body).not.toContain('scrypt');
  });

  it('usuário desativado: 401 mesmo com token ainda válido', async () => {
    await cadastrar();
    const { acesso } = await login('web');

    await desativar(db, EMAIL);
    esperarErro(await eu(autorizacao(acesso)), 401, 'token_invalido');
  });
});

describe('plugin de autenticação', () => {
  function registrarRotasDeTeste() {
    const { exigirUsuario, exigirEmpresa, exigirPerfil } = app.autenticacao;
    app.get(
      '/v1/teste/:empresa',
      { preHandler: [exigirUsuario, exigirEmpresa('empresa')] },
      async () => ({ ok: true }),
    );
    app.get(
      '/v1/teste-admin',
      { preHandler: [exigirUsuario, exigirPerfil('admin')] },
      async () => ({ ok: true }),
    );
  }

  it('exigirEmpresa: 403 para empresa fora do token', async () => {
    registrarRotasDeTeste();
    await cadastrar({ empresas: ['aba'] });
    const { acesso } = await login('web');

    const permitida = await app.inject({
      method: 'GET',
      url: '/v1/teste/aba',
      headers: autorizacao(acesso),
    });
    expect(permitida.statusCode).toBe(200);
    const proibida = await app.inject({
      method: 'GET',
      url: '/v1/teste/roma',
      headers: autorizacao(acesso),
    });
    esperarErro(proibida, 403, 'empresa_proibida');
    esperarErro(await app.inject({ method: 'GET', url: '/v1/teste/aba' }), 401, 'nao_autenticado');
  });

  it('exigirPerfil: 403 para perfil não permitido', async () => {
    registrarRotasDeTeste();
    await cadastrar();
    await cadastrar({ email: 'admin@exemplo.com', perfil: 'admin' });
    const arteFinalista = await login('web');
    const admin = await login('web', 'admin@exemplo.com');

    const negada = await app.inject({
      method: 'GET',
      url: '/v1/teste-admin',
      headers: autorizacao(arteFinalista.acesso),
    });
    esperarErro(negada, 403, 'perfil_proibido');
    const aceita = await app.inject({
      method: 'GET',
      url: '/v1/teste-admin',
      headers: autorizacao(admin.acesso),
    });
    expect(aceita.statusCode).toBe(200);
  });
});
