import { EsquemaPerfil, type Perfil } from '@plataforma/contratos';
import { errors, jwtVerify, SignJWT } from 'jose';
import { z } from 'zod';

export const DURACAO_ACESSO_MS = 15 * 60 * 1000;

const ALGORITMO = 'HS256';
const EMISSOR = 'rpa-plataforma-api';
const PUBLICO = 'rpa-plataforma';

export type DadosAcesso = { usuarioId: string; perfil: Perfil; empresas: string[] };

export type TokenAcesso = { token: string; expiraEm: Date };

export type ResultadoVerificacao =
  { valido: true; dados: DadosAcesso } | { valido: false; motivo: 'expirado' | 'invalido' };

const EsquemaClaims = z.object({
  sub: z.uuid(),
  perfil: EsquemaPerfil,
  empresas: z.array(z.string()),
});

const emSegundos = (data: Date) => Math.floor(data.getTime() / 1000);

// O instante vem de fora (relógio injetado) para os testes controlarem a expiração.
export function criarTokens(segredo: string) {
  const chave = new TextEncoder().encode(segredo);

  async function emitir(dados: DadosAcesso, agora: Date): Promise<TokenAcesso> {
    const emitidoEm = emSegundos(agora);
    const expiraEm = new Date(emitidoEm * 1000 + DURACAO_ACESSO_MS);
    const token = await new SignJWT({ perfil: dados.perfil, empresas: dados.empresas })
      .setProtectedHeader({ alg: ALGORITMO, typ: 'JWT' })
      .setSubject(dados.usuarioId)
      .setIssuer(EMISSOR)
      .setAudience(PUBLICO)
      .setIssuedAt(emitidoEm)
      .setExpirationTime(emSegundos(expiraEm))
      .sign(chave);
    return { token, expiraEm };
  }

  async function verificar(token: string, agora: Date): Promise<ResultadoVerificacao> {
    try {
      const { payload } = await jwtVerify(token, chave, {
        algorithms: [ALGORITMO],
        issuer: EMISSOR,
        audience: PUBLICO,
        currentDate: agora,
        requiredClaims: ['sub', 'exp', 'iat'],
      });
      const claims = EsquemaClaims.safeParse(payload);
      if (!claims.success) return { valido: false, motivo: 'invalido' };
      const { sub, perfil, empresas } = claims.data;
      return { valido: true, dados: { usuarioId: sub, perfil, empresas } };
    } catch (erro) {
      if (erro instanceof errors.JWTExpired) return { valido: false, motivo: 'expirado' };
      if (erro instanceof errors.JOSEError) return { valido: false, motivo: 'invalido' };
      throw erro;
    }
  }

  return { emitir, verificar };
}

export type Tokens = ReturnType<typeof criarTokens>;
