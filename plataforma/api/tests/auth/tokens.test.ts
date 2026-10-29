import { decodeJwt, SignJWT } from 'jose';
import { describe, expect, it } from 'vitest';

import { criarTokens, DURACAO_ACESSO_MS } from '../../src/auth/tokens.js';
import { SEGREDO_TESTE } from '../helpers/app.js';

const AGORA = new Date('2026-01-05T12:00:00.000Z');
const DADOS = {
  usuarioId: '7d4f0a52-3c1e-4b8a-9f2d-1e6c5b4a3d21',
  perfil: 'arte_finalista' as const,
  empresas: ['aba'],
};

const depois = (ms: number) => new Date(AGORA.getTime() + ms);

describe('tokens de acesso', () => {
  const tokens = criarTokens(SEGREDO_TESTE);

  it('emite um HS256 de 15 min com sub, perfil e empresas', async () => {
    const { token, expiraEm } = await tokens.emitir(DADOS, AGORA);

    expect(expiraEm).toEqual(depois(DURACAO_ACESSO_MS));
    const claims = decodeJwt(token);
    expect(claims).toMatchObject({
      sub: DADOS.usuarioId,
      perfil: 'arte_finalista',
      empresas: ['aba'],
    });
    expect((claims.exp ?? 0) - (claims.iat ?? 0)).toBe(15 * 60);
    expect(await tokens.verificar(token, depois(DURACAO_ACESSO_MS - 1000))).toEqual({
      valido: true,
      dados: DADOS,
    });
  });

  it('recusa o token expirado', async () => {
    const { token } = await tokens.emitir(DADOS, AGORA);
    expect(await tokens.verificar(token, depois(DURACAO_ACESSO_MS))).toEqual({
      valido: false,
      motivo: 'expirado',
    });
  });

  it('recusa token de outro segredo, adulterado ou sem as claims do contrato', async () => {
    const { token } = await criarTokens(`${SEGREDO_TESTE}-outro`).emitir(DADOS, AGORA);
    expect(await tokens.verificar(token, AGORA)).toEqual({ valido: false, motivo: 'invalido' });

    const [cabecalho, , assinatura] = (await tokens.emitir(DADOS, AGORA)).token.split('.');
    const corpo = Buffer.from(JSON.stringify({ ...decodeJwt(token), perfil: 'admin' })).toString(
      'base64url',
    );
    expect(await tokens.verificar(`${cabecalho}.${corpo}.${assinatura}`, AGORA)).toEqual({
      valido: false,
      motivo: 'invalido',
    });

    const semEmpresas = await new SignJWT({ perfil: 'admin' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(DADOS.usuarioId)
      .setIssuer('rpa-plataforma-api')
      .setAudience('rpa-plataforma')
      .setIssuedAt(AGORA)
      .setExpirationTime(depois(60_000))
      .sign(new TextEncoder().encode(SEGREDO_TESTE));
    expect(await tokens.verificar(semEmpresas, AGORA)).toEqual({
      valido: false,
      motivo: 'invalido',
    });
  });

  it('recusa emissor ou público diferentes e texto que não é JWT', async () => {
    const outroEmissor = await new SignJWT({ perfil: 'admin', empresas: ['aba'] })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(DADOS.usuarioId)
      .setIssuer('outro')
      .setAudience('rpa-plataforma')
      .setIssuedAt(AGORA)
      .setExpirationTime(depois(60_000))
      .sign(new TextEncoder().encode(SEGREDO_TESTE));
    expect(await tokens.verificar(outroEmissor, AGORA)).toMatchObject({ valido: false });
    expect(await tokens.verificar('nao-e-jwt', AGORA)).toEqual({
      valido: false,
      motivo: 'invalido',
    });
  });

  it('recusa alg "none"', async () => {
    const cabecalho = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString(
      'base64url',
    );
    const { token } = await tokens.emitir(DADOS, AGORA);
    const corpo = token.split('.')[1];
    expect(await tokens.verificar(`${cabecalho}.${corpo}.`, AGORA)).toEqual({
      valido: false,
      motivo: 'invalido',
    });
  });
});
