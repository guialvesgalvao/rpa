import { randomBytes } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { criarCifra } from '../../src/bling/cifra.js';
import { criarConexoesBling } from '../../src/bling/conexoes.js';
import { gerarCnpj } from '../../src/cli/semear-dev.js';
import { blingConexoes, empresas } from '../../src/db/esquema.js';
import { criarUsuario } from '../../src/usuarios/servico.js';
import { criarRelogioFalso } from '../helpers/app.js';
import { criarBancoTeste, limparTabelas } from '../helpers/banco.js';

const { db, fechar } = criarBancoTeste();
afterAll(() => fechar());

// Tokens fictícios.
const ACESSO = 'acesso-ficticio-1';
const RENOVACAO = 'renovacao-ficticia-1';
const CONTA = { cnpj: gerarCnpj(901), nome: 'Conta Fictícia Ltda' };

let relogio: ReturnType<typeof criarRelogioFalso>;
let conexoes: ReturnType<typeof criarConexoesBling>;
let roma: string;
let aba: string;
let usuarioId: string;

async function empresaId(slug: string) {
  const [linha] = await db.select().from(empresas).where(eq(empresas.slug, slug));
  if (!linha) throw new Error(`empresa ${slug} não semeada`);
  return linha.id;
}

beforeEach(async () => {
  await limparTabelas(db);
  relogio = criarRelogioFalso();
  conexoes = criarConexoesBling({
    db,
    cifra: criarCifra(randomBytes(32).toString('base64')),
    relogio: relogio.agora,
  });
  roma = await empresaId('roma');
  aba = await empresaId('aba');
  ({ id: usuarioId } = await criarUsuario(db, {
    email: 'admin@exemplo.com',
    nome: 'Admin Teste',
    perfil: 'admin',
    senha: 'senha-ficticia-123',
    empresas: ['roma'],
  }));
});

const expira = new Date('2026-01-05T18:00:00.000Z');

describe('conexões do Bling', () => {
  it('sem conexão devolve null', async () => {
    expect(await conexoes.obter(roma)).toBeNull();
  });

  it('salva e lê de volta, com o autor da autorização e a conta', async () => {
    await conexoes.salvar(roma, {
      accessToken: ACESSO,
      accessExpiraEm: expira,
      refreshToken: RENOVACAO,
      usuarioId,
      conta: CONTA,
    });
    expect(await conexoes.obter(roma)).toEqual({
      accessToken: ACESSO,
      accessExpiraEm: expira,
      refreshToken: RENOVACAO,
      autorizadoPor: usuarioId,
      autorizadoEm: relogio.agora(),
      atualizadoEm: relogio.agora(),
      conta: CONTA,
    });
    expect(await conexoes.conta(roma)).toEqual(CONTA);
    expect(await conexoes.obter(aba)).toBeNull();
    expect(await conexoes.conta(aba)).toBeNull();
  });

  it('conexão sem conta (anterior à verificação) devolve conta nula', async () => {
    await conexoes.salvar(roma, {
      accessToken: ACESSO,
      accessExpiraEm: expira,
      refreshToken: RENOVACAO,
    });
    expect((await conexoes.obter(roma))?.conta).toBeNull();
    expect(await conexoes.conta(roma)).toBeNull();
  });

  it('acha a outra empresa ligada a um CNPJ, ignorando a própria', async () => {
    await conexoes.salvar(aba, {
      accessToken: ACESSO,
      accessExpiraEm: expira,
      refreshToken: RENOVACAO,
      conta: CONTA,
    });
    expect(await conexoes.outraEmpresaComConta(CONTA.cnpj, roma)).toBe(aba);
    expect(await conexoes.outraEmpresaComConta(CONTA.cnpj, aba)).toBeNull();
    expect(await conexoes.outraEmpresaComConta(gerarCnpj(902), roma)).toBeNull();
  });

  it('não grava os tokens em claro no banco', async () => {
    await conexoes.salvar(roma, {
      accessToken: ACESSO,
      accessExpiraEm: expira,
      refreshToken: RENOVACAO,
    });
    const [linha] = await db.select().from(blingConexoes).where(eq(blingConexoes.empresaId, roma));
    const gravado = JSON.stringify(linha);
    expect(gravado).not.toContain(ACESSO);
    expect(gravado).not.toContain(RENOVACAO);
    expect(linha?.accessTokenCifrado).toMatch(/^v1\./);
    expect(linha?.refreshTokenCifrado).toMatch(/^v1\./);
  });

  it('o refresh sobrescreve os tokens e mantém autor, data da autorização e conta', async () => {
    await conexoes.salvar(roma, {
      accessToken: ACESSO,
      accessExpiraEm: expira,
      refreshToken: RENOVACAO,
      usuarioId,
      conta: CONTA,
    });
    const autorizadoEm = relogio.agora();
    relogio.avancar(60_000);
    const novaExpiracao = new Date('2026-01-06T00:00:00.000Z');
    await conexoes.salvar(roma, {
      accessToken: 'acesso-ficticio-2',
      accessExpiraEm: novaExpiracao,
      refreshToken: 'renovacao-ficticia-2',
    });

    expect(await conexoes.obter(roma)).toEqual({
      accessToken: 'acesso-ficticio-2',
      accessExpiraEm: novaExpiracao,
      refreshToken: 'renovacao-ficticia-2',
      autorizadoPor: usuarioId,
      autorizadoEm,
      atualizadoEm: relogio.agora(),
      conta: CONTA,
    });
    expect(await db.$count(blingConexoes)).toBe(1);
  });

  it('uma nova autorização troca o autor e a data', async () => {
    await conexoes.salvar(roma, {
      accessToken: ACESSO,
      accessExpiraEm: expira,
      refreshToken: RENOVACAO,
    });
    relogio.avancar(60_000);
    await conexoes.salvar(roma, {
      accessToken: ACESSO,
      accessExpiraEm: expira,
      refreshToken: RENOVACAO,
      usuarioId,
    });
    expect(await conexoes.obter(roma)).toMatchObject({
      autorizadoPor: usuarioId,
      autorizadoEm: relogio.agora(),
    });
  });

  it('apaga a conexão só da empresa pedida', async () => {
    await conexoes.salvar(roma, {
      accessToken: ACESSO,
      accessExpiraEm: expira,
      refreshToken: RENOVACAO,
    });
    await conexoes.salvar(aba, {
      accessToken: ACESSO,
      accessExpiraEm: expira,
      refreshToken: RENOVACAO,
    });
    await conexoes.apagar(roma);
    expect(await conexoes.obter(roma)).toBeNull();
    expect(await conexoes.obter(aba)).not.toBeNull();
    await expect(conexoes.apagar(roma)).resolves.toBeUndefined();
  });

  it('não lê tokens cifrados com outra chave', async () => {
    await conexoes.salvar(roma, {
      accessToken: ACESSO,
      accessExpiraEm: expira,
      refreshToken: RENOVACAO,
    });
    const outra = criarConexoesBling({ db, cifra: criarCifra(randomBytes(32).toString('base64')) });
    await expect(outra.obter(roma)).rejects.toThrow(/decifrar/);
  });
});
