import { randomBytes } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { SignJWT } from 'jose';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { z } from 'zod';

import { empresaPorId } from '../../src/artes/repositorio.js';
import { criarTokens } from '../../src/auth/tokens.js';
import { criarCifra } from '../../src/bling/cifra.js';
import {
  ErroBlingConcessaoInvalida,
  ErroBlingIndisponivel,
  type TokenBling,
} from '../../src/bling/cliente.js';
import { criarConexoesBling } from '../../src/bling/conexoes.js';
import {
  CAMINHO_DADOS_EMPRESA,
  criarOAuthBling,
  ErroBlingContaErrada,
  ErroBlingNaoConectado,
  ErroBlingSemEscopoEmpresa,
  ErroBlingStateInvalido,
  URL_AUTORIZACAO_BLING,
} from '../../src/bling/oauth.js';
import { gerarCnpj } from '../../src/cli/semear-dev.js';
import { blingConexoes, empresas } from '../../src/db/esquema.js';
import { criarUsuario } from '../../src/usuarios/servico.js';
import { criarRelogioFalso, SEGREDO_TESTE } from '../helpers/app.js';
import { criarBancoTeste, limparTabelas } from '../helpers/banco.js';

// Credenciais, tokens e CNPJs fictícios.
const CONFIG = { clientId: 'client-id-ficticio', clientSecret: 'client-secret-ficticio' };
const SEIS_HORAS_S = 6 * 60 * 60;
const CNPJ_ROMA = gerarCnpj(801);
const CNPJ_OUTRA = gerarCnpj(802);
const CONTA = { cnpj: CNPJ_ROMA, nome: 'Conta Fictícia Ltda' };
// O Bling devolve o CNPJ formatado.
const mascarar = (cnpj: string) =>
  cnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
const dadosEmpresa = (cnpj: string, nome = CONTA.nome) => ({
  id: 1,
  nome,
  cnpj: mascarar(cnpj),
  email: 'contato@exemplo.com',
  dataContrato: '2020-01-01',
});

type Obter = (
  caminho: string,
  esquema: z.ZodType,
  acesso: () => Promise<string>,
) => Promise<unknown>;

const { db, fechar } = criarBancoTeste();
afterAll(() => fechar());

let relogio: ReturnType<typeof criarRelogioFalso>;
let conexoes: ReturnType<typeof criarConexoesBling>;
let token: ReturnType<typeof vi.fn<(corpo: Record<string, string>) => Promise<TokenBling>>>;
let obter: ReturnType<typeof vi.fn<Obter>>;
let oauth: ReturnType<typeof criarOAuthBling>;
let roma: string;
let aba: string;
let usuarioId: string;

// O fake devolve os dados da conta passados pelo esquema real do `concluir`.
const respondeConta = (dados: unknown) =>
  obter.mockImplementation(async (_caminho, esquema) => esquema.parse(dados));

function montarOAuth(cnpjsEsperados: { roma?: string } = {}) {
  return criarOAuthBling({
    config: { ...CONFIG, cnpjsEsperados },
    cliente: { token, obter: obter as never },
    conexoes,
    empresas: (id) => empresaPorId(db, id),
    jwtSegredo: SEGREDO_TESTE,
    relogio: relogio.agora,
  });
}

beforeEach(async () => {
  await limparTabelas(db);
  relogio = criarRelogioFalso();
  conexoes = criarConexoesBling({
    db,
    cifra: criarCifra(randomBytes(32).toString('base64')),
    relogio: relogio.agora,
  });
  token = vi.fn<(corpo: Record<string, string>) => Promise<TokenBling>>();
  obter = vi.fn<Obter>();
  respondeConta(dadosEmpresa(CNPJ_ROMA));
  oauth = montarOAuth({ roma: CNPJ_ROMA });
  const [linha] = await db.select().from(empresas).where(eq(empresas.slug, 'roma'));
  roma = linha!.id;
  const [linhaAba] = await db.select().from(empresas).where(eq(empresas.slug, 'aba'));
  aba = linhaAba!.id;
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
  it('troca o código, confere a conta e grava a conexão da empresa do state', async () => {
    token.mockResolvedValueOnce(emissao('1'));
    const state = await stateDe(await oauth.urlAutorizacao(roma, usuarioId));

    expect(await oauth.concluir('codigo-ficticio', state)).toEqual({
      empresaId: roma,
      usuarioId,
      conta: CONTA,
    });

    expect(token).toHaveBeenCalledWith(
      { grant_type: 'authorization_code', code: 'codigo-ficticio' },
      CONFIG,
    );
    // Os dados da empresa são lidos com o access token recém-emitido.
    expect(obter).toHaveBeenCalledTimes(1);
    const [caminho, , acesso] = obter.mock.calls[0]!;
    expect(caminho).toBe(CAMINHO_DADOS_EMPRESA);
    expect(await acesso()).toBe('acesso-1');
    expect(await conexoes.obter(roma)).toMatchObject({
      accessToken: 'acesso-1',
      refreshToken: 'renovacao-1',
      accessExpiraEm: new Date(relogio.agora().getTime() + SEIS_HORAS_S * 1000),
      autorizadoPor: usuarioId,
      conta: CONTA,
    });
  });

  it('sem CNPJ esperado configurado, aceita a conta ainda não ligada a outra empresa', async () => {
    oauth = montarOAuth();
    token.mockResolvedValueOnce(emissao('1'));
    respondeConta(dadosEmpresa(CNPJ_OUTRA, 'Outra Conta Fictícia'));
    const state = await stateDe(await oauth.urlAutorizacao(roma, usuarioId));

    await oauth.concluir('c', state);
    expect(await conexoes.conta(roma)).toEqual({ cnpj: CNPJ_OUTRA, nome: 'Outra Conta Fictícia' });
  });

  it('CNPJ diferente do esperado: recusa sem gravar e sem expor o CNPJ', async () => {
    token.mockResolvedValueOnce(emissao('1'));
    respondeConta(dadosEmpresa(CNPJ_OUTRA));
    const state = await stateDe(await oauth.urlAutorizacao(roma, usuarioId));

    const erro = await oauth.concluir('c', state).catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(ErroBlingContaErrada);
    expect((erro as ErroBlingContaErrada).empresaNome).toBe('Roma Embalagens');
    expect(String(erro)).not.toContain(CNPJ_OUTRA);
    expect(await db.$count(blingConexoes)).toBe(0);
  });

  it('CNPJ já ligado a outra empresa: recusa sem gravar', async () => {
    oauth = montarOAuth();
    await conexoes.salvar(aba, {
      accessToken: 'acesso-aba',
      accessExpiraEm: relogio.agora(),
      refreshToken: 'renovacao-aba',
      conta: CONTA,
    });
    token.mockResolvedValueOnce(emissao('1'));
    const state = await stateDe(await oauth.urlAutorizacao(roma, usuarioId));

    await expect(oauth.concluir('c', state)).rejects.toBeInstanceOf(ErroBlingContaErrada);
    expect(await conexoes.obter(roma)).toBeNull();
  });

  it('reautorizar a mesma empresa com a mesma conta é aceito', async () => {
    token.mockResolvedValueOnce(emissao('1')).mockResolvedValueOnce(emissao('2'));
    await oauth.concluir('c1', await stateDe(await oauth.urlAutorizacao(roma, usuarioId)));
    await oauth.concluir('c2', await stateDe(await oauth.urlAutorizacao(roma, usuarioId)));
    expect(await conexoes.obter(roma)).toMatchObject({ accessToken: 'acesso-2', conta: CONTA });
  });

  it('403 nos dados da empresa (app sem o escopo): recusa sem gravar', async () => {
    token.mockResolvedValueOnce(emissao('1'));
    obter.mockRejectedValueOnce(new ErroBlingIndisponivel('insufficient_scope', 403));
    const state = await stateDe(await oauth.urlAutorizacao(roma, usuarioId));

    await expect(oauth.concluir('c', state)).rejects.toBeInstanceOf(ErroBlingSemEscopoEmpresa);
    expect(await db.$count(blingConexoes)).toBe(0);
  });

  it('outra falha nos dados da empresa segue como Bling indisponível, sem gravar', async () => {
    token.mockResolvedValueOnce(emissao('1'));
    obter.mockRejectedValueOnce(new ErroBlingIndisponivel('rede'));
    const state = await stateDe(await oauth.urlAutorizacao(roma, usuarioId));

    await expect(oauth.concluir('c', state)).rejects.toBeInstanceOf(ErroBlingIndisponivel);
    expect(await db.$count(blingConexoes)).toBe(0);
  });

  it('dados da empresa sem CNPJ: recusa sem gravar', async () => {
    token.mockResolvedValueOnce(emissao('1'));
    respondeConta({ id: 1, nome: 'Sem CNPJ', cnpj: '' });
    const state = await stateDe(await oauth.urlAutorizacao(roma, usuarioId));

    await expect(oauth.concluir('c', state)).rejects.toThrow();
    expect(await db.$count(blingConexoes)).toBe(0);
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

  it('perto do vencimento, renova e salva o refresh token novo, mantendo a conta', async () => {
    await conexoes.salvar(roma, {
      accessToken: 'acesso-atual',
      accessExpiraEm: daquiA(5 * 60 * 1000 - 1),
      refreshToken: 'renovacao-atual',
      usuarioId,
      conta: CONTA,
    });
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
      conta: CONTA,
    });
    expect(obter).not.toHaveBeenCalled();
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
