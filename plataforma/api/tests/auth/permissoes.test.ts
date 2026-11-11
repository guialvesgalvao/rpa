import { EsquemaErro, EsquemaEu, EsquemaRespostaEntrar, PERMISSOES } from '@plataforma/contratos';
import { and, eq, sql } from 'drizzle-orm';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { empresas, usuarioEmpresas, usuarios } from '../../src/db/esquema.js';
import {
  buscarAcesso,
  criarUsuario,
  definirEmpresas,
  listar,
  type NovoUsuario,
} from '../../src/usuarios/servico.js';
import { criarAppTeste } from '../helpers/app.js';
import { criarBancoTeste, limparTabelas } from '../helpers/banco.js';

const { db, fechar } = criarBancoTeste();
afterAll(() => fechar());

const SENHA = 'senha-ficticia-123';
const EMAIL = 'ana@exemplo.com';

let app: FastifyInstance;

beforeEach(async () => {
  await limparTabelas(db);
  ({ app } = criarAppTeste(db));
  const { exigirUsuario, exigirEmpresa, exigirPermissao, exigirPermissaoEmAlgumaEmpresa } =
    app.autenticacao;
  app.get(
    '/v1/teste/:empresa/editar',
    { preHandler: [exigirUsuario, exigirEmpresa('empresa'), exigirPermissao('artes.editar')] },
    async () => ({ ok: true }),
  );
  app.get(
    '/v1/teste-ops',
    { preHandler: [exigirUsuario, exigirPermissaoEmAlgumaEmpresa('ops')] },
    async () => ({ ok: true }),
  );
});
afterEach(() => app.close());

const cadastrar = (extra: Partial<NovoUsuario> = {}) =>
  criarUsuario(db, { email: EMAIL, nome: 'Ana Teste', senha: SENHA, empresas: ['aba'], ...extra });

async function login(email = EMAIL) {
  const resposta = await app.inject({
    method: 'POST',
    url: '/v1/auth/entrar',
    payload: { email, senha: SENHA, origem: 'web' },
  });
  expect(resposta.statusCode).toBe(200);
  return EsquemaRespostaEntrar.parse(resposta.json());
}

const pedir = (url: string, acesso: string) =>
  app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${acesso}` } });

function esperarErro(resposta: LightMyRequestResponse, status: number, codigo: string) {
  expect(resposta.statusCode).toBe(status);
  expect(EsquemaErro.parse(resposta.json()).erro.codigo).toBe(codigo);
}

async function definirPermissoes(email: string, slug: string, permissoes: string[]) {
  const [usuario] = await db
    .select({ id: usuarios.id })
    .from(usuarios)
    .where(eq(usuarios.email, email));
  const [empresa] = await db
    .select({ id: empresas.id })
    .from(empresas)
    .where(eq(empresas.slug, slug));
  await db
    .update(usuarioEmpresas)
    .set({ permissoes })
    .where(
      and(eq(usuarioEmpresas.usuarioId, usuario!.id), eq(usuarioEmpresas.empresaId, empresa!.id)),
    );
}

describe('criação com permissões', () => {
  it('sem perfil nem permissões: nasce sem nenhuma e com perfil legado de arte finalista', async () => {
    const criado = await cadastrar();
    expect(criado).toMatchObject({ perfil: 'arte_finalista', area: null, permissoes: { aba: [] } });
    const [linha] = await db.select({ perfil: usuarios.perfil }).from(usuarios);
    expect(linha?.perfil).toBeNull();
  });

  it('o atalho de perfil vira as permissões equivalentes em cada empresa', async () => {
    const admin = await cadastrar({ perfil: 'admin', empresas: ['aba', 'roma'] });
    expect(admin.permissoes).toEqual({ aba: [...PERMISSOES], roma: [...PERMISSOES] });
    expect(admin.perfil).toBe('admin');
    const finalista = await cadastrar({ email: 'bia@exemplo.com', perfil: 'arte_finalista' });
    expect(finalista.permissoes).toEqual({ aba: ['artes', 'artes.adicionar'] });
  });

  it('permissões por empresa e área são gravadas; subpermissão sem módulo é descartada', async () => {
    const criado = await cadastrar({
      area: 'producao',
      empresas: ['aba', 'roma'],
      permissoes: { aba: ['compras', 'compras.pedir', 'artes.editar'] },
    });
    expect(criado).toMatchObject({
      area: 'producao',
      perfil: 'admin',
      permissoes: { aba: ['compras', 'compras.pedir'], roma: [] },
    });
  });

  it('trocar as empresas mantém as permissões das que continuam', async () => {
    await cadastrar({ permissoes: { aba: ['ops'] } });
    await definirEmpresas(db, EMAIL, ['aba', 'roma']);
    const [usuario] = await listar(db);
    expect(usuario?.permissoes).toEqual({ aba: ['ops'], roma: [] });
  });
});

describe('/v1/eu e login', () => {
  it('devolvem área, permissões por empresa e o perfil legado', async () => {
    await cadastrar({
      area: 'direcao',
      empresas: ['aba', 'roma'],
      permissoes: { aba: ['artes'], roma: ['usuarios', 'usuarios.editar'] },
    });
    const { acesso, eu } = await login();
    const esperado = {
      perfil: 'admin',
      area: 'direcao',
      empresas: [
        { slug: 'aba', nome: 'ABA Embalagens', permissoes: ['artes'] },
        { slug: 'roma', nome: 'Roma Embalagens', permissoes: ['usuarios', 'usuarios.editar'] },
      ],
    };
    expect(eu).toMatchObject(esperado);
    const resposta = await pedir('/v1/eu', acesso);
    expect(EsquemaEu.parse(resposta.json())).toMatchObject(esperado);
  });

  it('usuário excluído não entra e o token dele deixa de valer', async () => {
    await cadastrar({ perfil: 'admin' });
    const { acesso } = await login();
    await db
      .update(usuarios)
      .set({ excluidoEm: sql`now()` })
      .where(eq(usuarios.email, EMAIL));

    esperarErro(await pedir('/v1/eu', acesso), 401, 'token_invalido');
    const novoLogin = await app.inject({
      method: 'POST',
      url: '/v1/auth/entrar',
      payload: { email: EMAIL, senha: SENHA, origem: 'web' },
    });
    esperarErro(novoLogin, 401, 'credenciais_invalidas');
    expect(await listar(db)).toEqual([]);
    const [usuario] = await db.select({ id: usuarios.id }).from(usuarios);
    expect((await buscarAcesso(db, usuario!.id)).ativo).toBe(false);
  });
});

describe('exigirPermissao', () => {
  it('permite com a permissão na empresa da rota e recusa sem ela', async () => {
    await cadastrar({
      empresas: ['aba', 'roma'],
      permissoes: { aba: ['artes', 'artes.editar'], roma: ['artes'] },
    });
    const { acesso } = await login();

    expect((await pedir('/v1/teste/aba/editar', acesso)).statusCode).toBe(200);
    esperarErro(await pedir('/v1/teste/roma/editar', acesso), 403, 'permissao_proibida');
  });

  it('subpermissão sem o módulo não vale', async () => {
    await cadastrar();
    await definirPermissoes(EMAIL, 'aba', ['artes.editar']);
    const { acesso } = await login();
    esperarErro(await pedir('/v1/teste/aba/editar', acesso), 403, 'permissao_proibida');
  });

  it('tirar a permissão vale na hora, com o mesmo token', async () => {
    await cadastrar({ permissoes: { aba: ['artes', 'artes.editar'] } });
    const { acesso } = await login();
    expect((await pedir('/v1/teste/aba/editar', acesso)).statusCode).toBe(200);

    await definirPermissoes(EMAIL, 'aba', ['artes']);
    esperarErro(await pedir('/v1/teste/aba/editar', acesso), 403, 'permissao_proibida');
  });

  it('em alguma empresa: basta uma delas ter a permissão', async () => {
    await cadastrar({ empresas: ['aba', 'roma'], permissoes: { roma: ['ops'] } });
    await cadastrar({ email: 'bia@exemplo.com', permissoes: { aba: ['artes'] } });
    const comOps = await login();
    const semOps = await login('bia@exemplo.com');

    expect((await pedir('/v1/teste-ops', comOps.acesso)).statusCode).toBe(200);
    esperarErro(await pedir('/v1/teste-ops', semOps.acesso), 403, 'permissao_proibida');
  });
});
