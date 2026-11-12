import {
  EsquemaErro,
  EsquemaRespostaEntrar,
  EsquemaUsuarioDetalhe,
  type Permissao,
  PERMISSOES,
} from '@plataforma/contratos';
import { eq } from 'drizzle-orm';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { sessoes, usuarios } from '../../src/db/esquema.js';
import { criarUsuario, desativar } from '../../src/usuarios/servico.js';
import { criarAppTeste } from '../helpers/app.js';
import { criarBancoTeste, limparTabelas } from '../helpers/banco.js';

const { db, fechar } = criarBancoTeste();
afterAll(() => fechar());

const SENHA = 'senha-ficticia-123';
const TODAS = [...PERMISSOES];
let app: FastifyInstance;

beforeEach(async () => {
  await limparTabelas(db);
  ({ app } = criarAppTeste(db));
});
afterEach(() => app.close());

type PorEmpresa = Record<string, Permissao[]>;

// Cria o usuário com as permissões informadas (as chaves são as empresas dele) e devolve id e token.
async function pessoa(email: string, permissoes: PorEmpresa) {
  const criado = await criarUsuario(db, {
    email,
    nome: `Pessoa ${email}`,
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

const chamar = (
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  url: string,
  token: string,
  payload?: object,
) =>
  app.inject({
    method,
    url: `/v1/empresas/${url}`,
    headers: { authorization: `Bearer ${token}` },
    ...(payload ? { payload } : {}),
  });

function esperarErro(resposta: LightMyRequestResponse, status: number, codigo: string) {
  expect(resposta.statusCode).toBe(status);
  expect(EsquemaErro.parse(resposta.json()).erro.codigo).toBe(codigo);
}

const detalhe = (resposta: LightMyRequestResponse) => EsquemaUsuarioDetalhe.parse(resposta.json());

const novo = (email: string, extra: Record<string, unknown> = {}) => ({
  nome: 'Usuário Fictício',
  email,
  area: 'producao',
  empresas: ['aba'],
  senha: 'senha-inicial-123',
  ...extra,
});

describe('GET /v1/empresas/:empresa/usuarios', () => {
  it('lista os usuários da empresa, com área e permissões; exige o módulo Usuários', async () => {
    const admin = await pessoa('admin@exemplo.com', { aba: TODAS, roma: TODAS });
    await pessoa('so-roma@exemplo.com', { roma: ['artes'] });
    const leitor = await pessoa('leitor@exemplo.com', { aba: ['usuarios'] });
    const semModulo = await pessoa('arte@exemplo.com', { aba: ['artes'] });

    const resposta = await chamar('GET', 'aba/usuarios', leitor.token);
    expect(resposta.statusCode).toBe(200);
    const lista = z.array(EsquemaUsuarioDetalhe).parse(resposta.json());
    expect(lista.map((usuario) => usuario.email)).toEqual([
      'admin@exemplo.com',
      'arte@exemplo.com',
      'leitor@exemplo.com',
    ]);
    expect(lista[0]).toMatchObject({
      id: admin.id,
      area: null,
      ativo: true,
      empresas: [
        { slug: 'aba', permissoes: TODAS },
        { slug: 'roma', permissoes: TODAS },
      ],
    });

    esperarErro(await chamar('GET', 'aba/usuarios', semModulo.token), 403, 'permissao_proibida');
    esperarErro(await chamar('GET', 'roma/usuarios', leitor.token), 403, 'empresa_proibida');
  });

  it('não mostra o excluído e mostra o desativado como inativo', async () => {
    const admin = await pessoa('admin@exemplo.com', { aba: TODAS });
    const excluida = await pessoa('excluida@exemplo.com', { aba: ['artes'] });
    await pessoa('inativa@exemplo.com', { aba: ['artes'] });
    await desativar(db, 'inativa@exemplo.com');
    expect((await chamar('DELETE', `aba/usuarios/${excluida.id}`, admin.token)).statusCode).toBe(
      204,
    );

    const lista = z
      .array(EsquemaUsuarioDetalhe)
      .parse((await chamar('GET', 'aba/usuarios', admin.token)).json());
    expect(lista.map(({ email, ativo }) => ({ email, ativo }))).toEqual([
      { email: 'admin@exemplo.com', ativo: true },
      { email: 'inativa@exemplo.com', ativo: false },
    ]);
  });
});

describe('POST /v1/empresas/:empresa/usuarios', () => {
  it('quem edita usuários e permissões cria com área e permissões; a senha inicial pede troca', async () => {
    const admin = await pessoa('admin@exemplo.com', { aba: TODAS });
    const resposta = await chamar(
      'POST',
      'aba/usuarios',
      admin.token,
      novo('Nova@Exemplo.com', { permissoes: { aba: ['compras', 'compras.pedir'] } }),
    );
    expect(resposta.statusCode).toBe(201);
    expect(detalhe(resposta)).toMatchObject({
      email: 'nova@exemplo.com',
      area: 'producao',
      empresas: [{ slug: 'aba', permissoes: ['compras', 'compras.pedir'] }],
    });
    expect(resposta.body).not.toContain('scrypt');
    const [linha] = await db.select().from(usuarios).where(eq(usuarios.email, 'nova@exemplo.com'));
    expect(linha).toMatchObject({ deveTrocarSenha: true, perfil: null });
  });

  it('sem "Editar permissão": cria sem permissões e não consegue informá-las', async () => {
    const editor = await pessoa('editor@exemplo.com', { aba: ['usuarios', 'usuarios.editar'] });
    const semPermissoes = await chamar('POST', 'aba/usuarios', editor.token, novo('a@exemplo.com'));
    expect(detalhe(semPermissoes).empresas).toEqual([{ slug: 'aba', permissoes: [] }]);

    esperarErro(
      await chamar(
        'POST',
        'aba/usuarios',
        editor.token,
        novo('b@exemplo.com', { permissoes: { aba: ['artes'] } }),
      ),
      403,
      'permissao_proibida',
    );
  });

  it('recusa quem só vê a lista, empresa fora do alcance, e-mail repetido e dado inválido', async () => {
    const admin = await pessoa('admin@exemplo.com', { aba: TODAS });
    const leitor = await pessoa('leitor@exemplo.com', { aba: ['usuarios'] });

    esperarErro(
      await chamar('POST', 'aba/usuarios', leitor.token, novo('a@exemplo.com')),
      403,
      'permissao_proibida',
    );
    esperarErro(
      await chamar(
        'POST',
        'aba/usuarios',
        admin.token,
        novo('a@exemplo.com', { empresas: ['roma'] }),
      ),
      403,
      'empresa_proibida',
    );
    esperarErro(
      await chamar('POST', 'aba/usuarios', admin.token, novo('admin@exemplo.com')),
      409,
      'email_em_uso',
    );
    esperarErro(
      await chamar('POST', 'aba/usuarios', admin.token, novo('a@exemplo.com', { senha: 'curta' })),
      400,
      'requisicao_invalida',
    );
    esperarErro(
      await chamar('POST', 'aba/usuarios', admin.token, novo('a@exemplo.com', { area: 'outra' })),
      400,
      'requisicao_invalida',
    );
  });

  it('permissão para empresa que não é do usuário novo é recusada', async () => {
    const admin = await pessoa('admin@exemplo.com', { aba: TODAS, roma: TODAS });
    esperarErro(
      await chamar(
        'POST',
        'aba/usuarios',
        admin.token,
        novo('a@exemplo.com', { permissoes: { roma: ['artes'] } }),
      ),
      403,
      'permissao_proibida',
    );
  });
});

describe('PATCH /v1/empresas/:empresa/usuarios/:id', () => {
  it('edita nome, e-mail, área e empresas, mantendo as permissões das empresas que continuam', async () => {
    const admin = await pessoa('admin@exemplo.com', { aba: TODAS, roma: TODAS });
    const alvo = await pessoa('alvo@exemplo.com', { aba: ['artes', 'artes.adicionar'] });

    const resposta = await chamar('PATCH', `aba/usuarios/${alvo.id}`, admin.token, {
      nome: 'Nome Novo',
      email: 'Novo@Exemplo.com',
      area: 'direcao',
      empresas: ['aba', 'roma'],
    });
    expect(resposta.statusCode).toBe(200);
    expect(detalhe(resposta)).toMatchObject({
      nome: 'Nome Novo',
      email: 'novo@exemplo.com',
      area: 'direcao',
      empresas: [
        { slug: 'aba', permissoes: ['artes', 'artes.adicionar'] },
        { slug: 'roma', permissoes: [] },
      ],
    });

    const semArea = await chamar('PATCH', `aba/usuarios/${alvo.id}`, admin.token, { area: null });
    expect(detalhe(semArea)).toMatchObject({ nome: 'Nome Novo', area: null });
  });

  it('recusa e-mail de outro usuário, corpo vazio, id desconhecido e usuário de outra empresa', async () => {
    const admin = await pessoa('admin@exemplo.com', { aba: TODAS });
    const alvo = await pessoa('alvo@exemplo.com', { aba: ['artes'] });
    const deOutra = await pessoa('roma@exemplo.com', { roma: ['artes'] });
    const url = `aba/usuarios/${alvo.id}`;

    esperarErro(
      await chamar('PATCH', url, admin.token, { email: 'admin@exemplo.com' }),
      409,
      'email_em_uso',
    );
    esperarErro(await chamar('PATCH', url, admin.token, {}), 400, 'requisicao_invalida');
    esperarErro(
      await chamar('PATCH', 'aba/usuarios/nao-e-uuid', admin.token, { nome: 'X' }),
      404,
      'usuario_nao_encontrado',
    );
    esperarErro(
      await chamar('PATCH', `aba/usuarios/${deOutra.id}`, admin.token, { nome: 'X' }),
      404,
      'usuario_nao_encontrado',
    );
  });

  it('quem edita usuários só na ABA não altera nem exclui quem também está na Roma', async () => {
    await pessoa('admin@exemplo.com', { aba: TODAS, roma: TODAS });
    const soAba = await pessoa('editor@exemplo.com', {
      aba: ['usuarios', 'usuarios.editar', 'usuarios.permissoes'],
    });
    const nasDuas = await pessoa('duas@exemplo.com', { aba: ['artes'], roma: ['artes'] });
    const url = `aba/usuarios/${nasDuas.id}`;

    esperarErro(await chamar('PATCH', url, soAba.token, { nome: 'X' }), 403, 'empresa_proibida');
    esperarErro(await chamar('DELETE', url, soAba.token), 403, 'empresa_proibida');
    // As permissões dele na ABA, sim.
    const resposta = await chamar('PATCH', `${url}/permissoes`, soAba.token, {
      permissoes: ['ops'],
    });
    expect(detalhe(resposta).empresas).toEqual([
      { slug: 'aba', permissoes: ['ops'] },
      { slug: 'roma', permissoes: ['artes'] },
    ]);
  });

  it('não dá ao usuário uma empresa em que quem edita não pode editar usuários', async () => {
    const soAba = await pessoa('editor@exemplo.com', { aba: ['usuarios', 'usuarios.editar'] });
    const alvo = await pessoa('alvo@exemplo.com', { aba: ['artes'] });
    esperarErro(
      await chamar('PATCH', `aba/usuarios/${alvo.id}`, soAba.token, { empresas: ['aba', 'roma'] }),
      403,
      'empresa_proibida',
    );
  });
});

describe('PATCH /v1/empresas/:empresa/usuarios/:id/permissoes', () => {
  it('define as permissões na empresa da rota e o efeito é imediato', async () => {
    const admin = await pessoa('admin@exemplo.com', { aba: TODAS });
    const alvo = await pessoa('alvo@exemplo.com', { aba: ['artes'] });
    expect((await chamar('GET', 'aba/clientes', alvo.token)).statusCode).toBe(200);

    const resposta = await chamar('PATCH', `aba/usuarios/${alvo.id}/permissoes`, admin.token, {
      permissoes: ['compras', 'artes.editar'],
    });
    // Subpermissão sem o módulo é descartada.
    expect(detalhe(resposta).empresas).toEqual([{ slug: 'aba', permissoes: ['compras'] }]);
    esperarErro(await chamar('GET', 'aba/clientes', alvo.token), 403, 'permissao_proibida');
  });

  it('exige "Editar permissão" e recusa chave fora do catálogo', async () => {
    const admin = await pessoa('admin@exemplo.com', { aba: TODAS });
    const editor = await pessoa('editor@exemplo.com', { aba: ['usuarios', 'usuarios.editar'] });
    const url = `aba/usuarios/${editor.id}/permissoes`;

    esperarErro(
      await chamar('PATCH', url, editor.token, { permissoes: TODAS }),
      403,
      'permissao_proibida',
    );
    esperarErro(
      await chamar('PATCH', url, admin.token, { permissoes: ['inventada'] }),
      400,
      'requisicao_invalida',
    );
  });

  it('ninguém tira de si mesmo a permissão de editar permissões', async () => {
    const admin = await pessoa('admin@exemplo.com', { aba: TODAS });
    await pessoa('outro@exemplo.com', { aba: TODAS });
    const url = `aba/usuarios/${admin.id}/permissoes`;

    esperarErro(
      await chamar('PATCH', url, admin.token, { permissoes: ['usuarios', 'usuarios.editar'] }),
      409,
      'propria_permissao',
    );
    // Tirar outra coisa de si mesmo pode.
    const resposta = await chamar('PATCH', url, admin.token, {
      permissoes: ['usuarios', 'usuarios.permissoes'],
    });
    expect(resposta.statusCode).toBe(200);
  });

  it('a empresa não fica sem ninguém que edite permissões', async () => {
    const admin = await pessoa('admin@exemplo.com', { aba: TODAS, roma: TODAS });
    const unico = await pessoa('unico@exemplo.com', { aba: ['artes'], roma: TODAS });
    // Na Roma há dois; na ABA só o admin. Tirar do `unico` na Roma pode; depois, o admin vira o último.
    const tira = (id: string, empresa: string) =>
      chamar('PATCH', `${empresa}/usuarios/${id}/permissoes`, admin.token, {
        permissoes: ['artes'],
      });

    expect((await tira(unico.id, 'roma')).statusCode).toBe(200);
    await pessoa('editor@exemplo.com', { aba: ['usuarios', 'usuarios.editar'], roma: ['artes'] });
    const editorDaRoma = await pessoa('editor-roma@exemplo.com', {
      roma: ['usuarios', 'usuarios.editar'],
      aba: ['usuarios', 'usuarios.editar'],
    });
    // Excluir o último que edita permissões na Roma (o admin) é recusado, mesmo por quem pode excluir.
    esperarErro(
      await chamar('DELETE', `roma/usuarios/${admin.id}`, editorDaRoma.token),
      409,
      'ultimo_administrador',
    );
    // E nada mudou: o admin continua entrando.
    expect((await chamar('GET', 'roma/usuarios', admin.token)).statusCode).toBe(200);
  });
});

describe('DELETE /v1/empresas/:empresa/usuarios/:id', () => {
  it('exclui: acesso cortado na hora, sessões revogadas, some da lista e o e-mail continua bloqueado', async () => {
    const admin = await pessoa('admin@exemplo.com', { aba: TODAS });
    const alvo = await pessoa('alvo@exemplo.com', { aba: ['artes'] });
    expect((await chamar('GET', 'aba/clientes', alvo.token)).statusCode).toBe(200);

    expect((await chamar('DELETE', `aba/usuarios/${alvo.id}`, admin.token)).statusCode).toBe(204);

    esperarErro(await chamar('GET', 'aba/clientes', alvo.token), 401, 'token_invalido');
    const login = await app.inject({
      method: 'POST',
      url: '/v1/auth/entrar',
      payload: { email: 'alvo@exemplo.com', senha: SENHA, origem: 'web' },
    });
    esperarErro(login, 401, 'credenciais_invalidas');
    const abertas = await db.select().from(sessoes).where(eq(sessoes.usuarioId, alvo.id));
    expect(abertas.every((sessao) => sessao.motivoRevogacao === 'usuario_excluido')).toBe(true);
    const [linha] = await db.select().from(usuarios).where(eq(usuarios.id, alvo.id));
    expect(linha?.excluidoEm).toBeInstanceOf(Date);

    esperarErro(
      await chamar('POST', 'aba/usuarios', admin.token, novo('alvo@exemplo.com')),
      409,
      'email_em_uso',
    );
    esperarErro(
      await chamar('DELETE', `aba/usuarios/${alvo.id}`, admin.token),
      404,
      'usuario_nao_encontrado',
    );
  });

  it('ninguém exclui a si mesmo; quem só vê a lista não exclui', async () => {
    const admin = await pessoa('admin@exemplo.com', { aba: TODAS });
    const leitor = await pessoa('leitor@exemplo.com', { aba: ['usuarios'] });

    esperarErro(
      await chamar('DELETE', `aba/usuarios/${admin.id}`, admin.token),
      409,
      'proprio_usuario',
    );
    esperarErro(
      await chamar('DELETE', `aba/usuarios/${admin.id}`, leitor.token),
      403,
      'permissao_proibida',
    );
  });
});

describe('POST /v1/empresas/:empresa/usuarios/:id/senha', () => {
  const entrar = (email: string, senha: string) =>
    app.inject({
      method: 'POST',
      url: '/v1/auth/entrar',
      payload: { email, senha, origem: 'web' },
    });

  it('define uma senha temporária: a antiga deixa de valer, a nova pede troca e as sessões seguem', async () => {
    const admin = await pessoa('admin@exemplo.com', { aba: TODAS });
    const alvo = await pessoa('alvo@exemplo.com', { aba: ['artes'] });

    const resposta = await chamar('POST', `aba/usuarios/${alvo.id}/senha`, admin.token, {
      novaSenha: '1234567890',
    });
    expect(resposta.statusCode).toBe(204);

    esperarErro(await entrar('alvo@exemplo.com', SENHA), 401, 'credenciais_invalidas');
    const login = await entrar('alvo@exemplo.com', '1234567890');
    expect(login.statusCode).toBe(200);
    expect(EsquemaRespostaEntrar.parse(login.json()).eu.deveTrocarSenha).toBe(true);
    // A sessão que já estava aberta continua valendo.
    expect((await chamar('GET', 'aba/clientes', alvo.token)).statusCode).toBe(200);
  });

  it('exige "Editar usuários", senha com o mínimo e alvo da empresa da rota', async () => {
    const admin = await pessoa('admin@exemplo.com', { aba: TODAS });
    const leitor = await pessoa('leitor@exemplo.com', { aba: ['usuarios'] });
    const alvo = await pessoa('alvo@exemplo.com', { aba: ['artes'] });
    const deOutra = await pessoa('roma@exemplo.com', { roma: ['artes'] });
    const corpo = { novaSenha: '1234567890' };

    esperarErro(
      await chamar('POST', `aba/usuarios/${alvo.id}/senha`, leitor.token, corpo),
      403,
      'permissao_proibida',
    );
    esperarErro(
      await chamar('POST', `aba/usuarios/${alvo.id}/senha`, admin.token, {
        novaSenha: '123456789',
      }),
      400,
      'requisicao_invalida',
    );
    esperarErro(
      await chamar('POST', `aba/usuarios/${deOutra.id}/senha`, admin.token, corpo),
      404,
      'usuario_nao_encontrado',
    );
    esperarErro(
      await chamar('POST', 'aba/usuarios/nao-e-uuid/senha', admin.token, corpo),
      404,
      'usuario_nao_encontrado',
    );
    expect((await chamar('DELETE', `aba/usuarios/${alvo.id}`, admin.token)).statusCode).toBe(204);
    esperarErro(
      await chamar('POST', `aba/usuarios/${alvo.id}/senha`, admin.token, corpo),
      404,
      'usuario_nao_encontrado',
    );
  });

  it('não redefine quem também está numa empresa em que falta "Editar usuários", nem a si mesmo', async () => {
    const admin = await pessoa('admin@exemplo.com', { aba: TODAS, roma: TODAS });
    const soAba = await pessoa('editor@exemplo.com', { aba: ['usuarios', 'usuarios.editar'] });
    const nasDuas = await pessoa('duas@exemplo.com', { aba: ['artes'], roma: ['artes'] });
    const corpo = { novaSenha: '1234567890' };

    esperarErro(
      await chamar('POST', `aba/usuarios/${nasDuas.id}/senha`, soAba.token, corpo),
      403,
      'empresa_proibida',
    );
    esperarErro(
      await chamar('POST', `aba/usuarios/${admin.id}/senha`, admin.token, corpo),
      409,
      'proprio_usuario',
    );
    expect((await entrar('duas@exemplo.com', SENHA)).statusCode).toBe(200);
    expect((await entrar('admin@exemplo.com', SENHA)).statusCode).toBe(200);
  });
});

describe('rotas antigas /v1/usuarios (app anterior às permissões)', () => {
  it('continuam listando e criando com `perfil`, que vira permissões', async () => {
    const admin = await pessoa('admin@exemplo.com', { aba: TODAS });
    const criar = await app.inject({
      method: 'POST',
      url: '/v1/usuarios',
      headers: { authorization: `Bearer ${admin.token}` },
      payload: {
        nome: 'Arte Finalista Fictícia',
        email: 'finalista@exemplo.com',
        perfil: 'arte_finalista',
        empresas: ['aba'],
        senha: 'senha-inicial-123',
      },
    });
    expect(criar.statusCode).toBe(201);
    expect(criar.json()).toMatchObject({ perfil: 'arte_finalista', empresas: ['aba'] });

    const lista = z
      .array(EsquemaUsuarioDetalhe)
      .parse((await chamar('GET', 'aba/usuarios', admin.token)).json());
    expect(lista.find((usuario) => usuario.email === 'finalista@exemplo.com')?.empresas).toEqual([
      { slug: 'aba', permissoes: ['artes', 'artes.adicionar'] },
    ]);
  });
});
