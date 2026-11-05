import { randomBytes } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { SignJWT } from 'jose';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { criarTokens } from '../../src/auth/tokens.js';
import { criarCifra } from '../../src/bling/cifra.js';
import {
  ErroBlingConcessaoInvalida,
  ErroBlingIndisponivel,
  type TokenBling,
} from '../../src/bling/cliente.js';
import { criarConexoesBling } from '../../src/bling/conexoes.js';
import {
  criarOAuthBling,
  ErroBlingNaoConectado,
  ErroBlingStateInvalido,
  URL_AUTORIZACAO_BLING,
} from '../../src/bling/oauth.js';
import { empresas } from '../../src/db/esquema.js';
import { criarUsuario } from '../../src/usuarios/servico.js';
import { criarRelogioFalso, SEGREDO_TESTE } from '../helpers/app.js';
import { criarBancoTeste, limparTabelas } from '../helpers/banco.js';

// Credenciais e tokens fictícios.
const CONFIG = { clientId: 'client-id-ficticio', clientSecret: 'client-secret-ficticio' };
const SEIS_HORAS_S = 6 * 60 * 60;

const { db, fechar } = criarBancoTeste();
afterAll(() => fechar());

let relogio: ReturnType<typeof criarRelogioFalso>;
let conexoes: ReturnType<typeof criarConexoesBling>;
let token: ReturnType<typeof vi.fn<(corpo: Record<string, string>) => Promise<TokenBling>>>;
let oauth: ReturnType<typeof criarOAuthBling>;
let roma: string;
let usuarioId: string;

beforeEach(async () => {
  await limparTabelas(db);
  relogio = criarRelogioFalso();
  conexoes = criarConexoesBling({
    db,
    cifra: criarCifra(randomBytes(32).toString('base64')),
    relogio: relogio.agora,
  });
  token = vi.fn<(corpo: Record<string, string>) => Promise<TokenBling>>();
  oauth = criarOAuthBling({
    config: CONFIG,
    cliente: { token },
    conexoes,
    jwtSegredo: SEGREDO_TESTE,
    relogio: relogio.agora,
  });
  const [linha] = await db.select().from(empresas).where(eq(empresas.slug, 'roma'));
  roma = linha!.id;
  ({ id: usuarioId } = await criarUsuario(db, {
    email: 'admin@exemplo.com',
    nome: 'Admin Teste',
    perfil: 'admin',
    senha: 'senha-ficticia-123',
    empresas: ['roma'],
  }));
});

const stateDe = async (url: string) => new URL(url).searchParams.get('state') ?? '';
const emissao = (sufixo: string): TokenBling => ({
  access_token: `acesso-${sufixo}`,
  refresh_token: `renovacao-${sufixo}`,
  expires_in: SEIS_HORAS_S,
});

describe('urlAutorizacao', () => {
  it('monta a URL do Bling com client_id e state', async () => {
    const url = new URL(await oauth.urlAutorizacao(roma, usuarioId));
    expect(`${url.origin}${url.pathname}`).toBe(URL_AUTORIZACAO_BLING);
    expect(url.protocol).toBe('https:');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('client_id')).toBe(CONFIG.clientId);
    expect(url.searchParams.get('state')).toMatch(/^[\w-]+\.[\w-]+\.[\w-]+$/);
    expect(url.toString()).not.toContain(CONFIG.clientSecret);
  });
});

describe('concluir', () => {
  it('troca o código e grava a conexão da empresa do state', async () => {
    token.mockResolvedValueOnce(emissao('1'));
    const state = await stateDe(await oauth.urlAutorizacao(roma, usuarioId));

    expect(await oauth.concluir('codigo-ficticio', state)).toEqual({ empresaId: roma, usuarioId });

    expect(token).toHaveBeenCalledWith(
      { grant_type: 'authorization_code', code: 'codigo-ficticio' },
      CONFIG,
    );
    expect(await conexoes.obter(roma)).toMatchObject({
      accessToken: 'acesso-1',
      refreshToken: 'renovacao-1',
      accessExpiraEm: new Date(relogio.agora().getTime() + SEIS_HORAS_S * 1000),
      autorizadoPor: usuarioId,
    });
  });

  it('recusa state adulterado', async () => {
    const state = await stateDe(await oauth.urlAutorizacao(roma, usuarioId));
    const [cabecalho, , assinatura] = state.split('.');
    const corpo = Buffer.from(JSON.stringify({ empresa: roma, sub: usuarioId, exp: 9e9 })).toString(
      'base64url',
    );
    await expect(oauth.concluir('c', `${cabecalho}.${corpo}.${assinatura}`)).rejects.toBeInstanceOf(
      ErroBlingStateInvalido,
    );
    await expect(oauth.concluir('c', 'nao-e-jwt')).rejects.toBeInstanceOf(ErroBlingStateInvalido);
    expect(token).not.toHaveBeenCalled();
  });

  it('recusa state vencido (mais de 10 min)', async () => {
    const state = await stateDe(await oauth.urlAutorizacao(roma, usuarioId));
    relogio.avancar(10 * 60 * 1000 + 1000);
    await expect(oauth.concluir('c', state)).rejects.toBeInstanceOf(ErroBlingStateInvalido);
    expect(token).not.toHaveBeenCalled();
  });

  it('recusa um token de acesso da API usado como state (outro público)', async () => {
    const { token: acessoApi } = await criarTokens(SEGREDO_TESTE).emitir(
      { usuarioId, perfil: 'admin', empresas: ['roma'] },
      relogio.agora(),
    );
    await expect(oauth.concluir('c', acessoApi)).rejects.toBeInstanceOf(ErroBlingStateInvalido);
  });

  it('recusa state assinado com outro segredo ou sem a empresa', async () => {
    const agora = Math.floor(relogio.agora().getTime() / 1000);
    const assinar = (claims: object, segredo: string) =>
      new SignJWT({ ...claims })
        .setProtectedHeader({ alg: 'HS256' })
        .setSubject(usuarioId)
        .setIssuer('rpa-plataforma-api')
        .setAudience('rpa-bling-oauth')
        .setIssuedAt(agora)
        .setExpirationTime(agora + 600)
        .sign(new TextEncoder().encode(segredo));

    const outroSegredo = await assinar({ empresa: roma }, 'outro-segredo-ficticio-0123456789abc');
    await expect(oauth.concluir('c', outroSegredo)).rejects.toBeInstanceOf(ErroBlingStateInvalido);
    const semEmpresa = await assinar({}, SEGREDO_TESTE);
    await expect(oauth.concluir('c', semEmpresa)).rejects.toBeInstanceOf(ErroBlingStateInvalido);
    expect(token).not.toHaveBeenCalled();
  });
});

describe('acessoValido', () => {
  const conectar = (accessExpiraEm: Date) =>
    conexoes.salvar(roma, {
      accessToken: 'acesso-atual',
      accessExpiraEm,
      refreshToken: 'renovacao-atual',
      usuarioId,
    });
  const daquiA = (ms: number) => new Date(relogio.agora().getTime() + ms);

  it('sem conexão → não conectado', async () => {
    await expect(oauth.acessoValido(roma)).rejects.toBeInstanceOf(ErroBlingNaoConectado);
  });

  it('com mais de 5 min de validade, devolve o token atual sem refresh', async () => {
    await conectar(daquiA(5 * 60 * 1000));
    expect(await oauth.acessoValido(roma)).toBe('acesso-atual');
    expect(token).not.toHaveBeenCalled();
  });

  it('perto do vencimento, renova e salva o refresh token novo', async () => {
    await conectar(daquiA(5 * 60 * 1000 - 1));
    token.mockResolvedValueOnce(emissao('novo'));

    expect(await oauth.acessoValido(roma)).toBe('acesso-novo');

    expect(token).toHaveBeenCalledWith(
      { grant_type: 'refresh_token', refresh_token: 'renovacao-atual' },
      CONFIG,
    );
    expect(await conexoes.obter(roma)).toMatchObject({
      accessToken: 'acesso-novo',
      refreshToken: 'renovacao-novo',
      autorizadoPor: usuarioId,
    });
  });

  it('chamadas simultâneas fazem um único refresh', async () => {
    await conectar(daquiA(-1000));
    token.mockResolvedValueOnce(emissao('novo'));
    const tokens = await Promise.all([oauth.acessoValido(roma), oauth.acessoValido(roma)]);
    expect(tokens).toEqual(['acesso-novo', 'acesso-novo']);
    expect(token).toHaveBeenCalledTimes(1);
  });

  it('invalid_grant apaga a conexão e responde não conectado', async () => {
    await conectar(daquiA(-1000));
    token.mockRejectedValueOnce(new ErroBlingConcessaoInvalida());

    await expect(oauth.acessoValido(roma)).rejects.toBeInstanceOf(ErroBlingNaoConectado);
    expect(await conexoes.obter(roma)).toBeNull();
  });

  it('Bling fora do ar no refresh mantém a conexão', async () => {
    await conectar(daquiA(-1000));
    token.mockRejectedValueOnce(new ErroBlingIndisponivel('rede'));

    await expect(oauth.acessoValido(roma)).rejects.toBeInstanceOf(ErroBlingIndisponivel);
    expect(await conexoes.obter(roma)).toMatchObject({ refreshToken: 'renovacao-atual' });
  });
});
