import { errors, jwtVerify, SignJWT } from 'jose';
import { z } from 'zod';

import type { ConfigBling } from '../config.js';
import {
  type ClienteBling,
  ErroBling,
  ErroBlingConcessaoInvalida,
  type TokenBling,
} from './cliente.js';
import type { ConexoesBling } from './conexoes.js';

export const URL_AUTORIZACAO_BLING = 'https://www.bling.com.br/Api/v3/oauth/authorize';
export const DURACAO_STATE_MS = 10 * 60 * 1000;
// Refresh antecipado: o job pode passar alguns minutos com o mesmo token.
export const MARGEM_REFRESH_MS = 5 * 60 * 1000;

const ALGORITMO = 'HS256';
const EMISSOR = 'rpa-plataforma-api';
// Público próprio: o `state` nunca serve como token de acesso da API, nem o contrário.
const PUBLICO_STATE = 'rpa-bling-oauth';

export class ErroBlingNaoConectado extends ErroBling {
  override name = 'ErroBlingNaoConectado';
  constructor() {
    super('A empresa não está conectada ao Bling.');
  }
}

export class ErroBlingStateInvalido extends ErroBling {
  override name = 'ErroBlingStateInvalido';
  constructor() {
    super('Autorização do Bling inválida ou vencida.');
  }
}

const EsquemaClaimsState = z.object({ sub: z.uuid(), empresa: z.uuid() });

export type OAuthBling = {
  // Link que o usuário abre no navegador para autorizar a empresa no Bling.
  urlAutorizacao(empresaId: string, usuarioId: string): Promise<string>;
  // Retorno do Bling: valida o `state`, troca o código e grava a conexão da empresa do `state`.
  concluir(code: string, state: string): Promise<{ empresaId: string; usuarioId: string }>;
  // Access token válido da empresa, com refresh quando vence em menos de 5 min.
  acessoValido(empresaId: string): Promise<string>;
};

const emSegundos = (data: Date) => Math.floor(data.getTime() / 1000);

export function criarOAuthBling({
  config,
  cliente,
  conexoes,
  jwtSegredo,
  relogio = () => new Date(),
}: {
  config: Pick<ConfigBling, 'clientId' | 'clientSecret'>;
  cliente: Pick<ClienteBling, 'token'>;
  conexoes: ConexoesBling;
  jwtSegredo: string;
  relogio?: () => Date;
}): OAuthBling {
  const chave = new TextEncoder().encode(jwtSegredo);
  const credenciais = { clientId: config.clientId, clientSecret: config.clientSecret };
  // Uma resolução por empresa de cada vez: dois refreshes simultâneos gastariam o mesmo refresh token, e o
  // Bling pode invalidar o anterior.
  const pendentes = new Map<string, Promise<string>>();

  const expiracao = (token: TokenBling) => new Date(relogio().getTime() + token.expires_in * 1000);

  async function renovar(empresaId: string, refreshToken: string): Promise<string> {
    let token: TokenBling;
    try {
      token = await cliente.token(
        { grant_type: 'refresh_token', refresh_token: refreshToken },
        credenciais,
      );
    } catch (erro) {
      if (erro instanceof ErroBlingConcessaoInvalida) {
        await conexoes.apagar(empresaId);
        throw new ErroBlingNaoConectado();
      }
      throw erro;
    }
    // Sempre o último refresh token recebido.
    await conexoes.salvar(empresaId, {
      accessToken: token.access_token,
      accessExpiraEm: expiracao(token),
      refreshToken: token.refresh_token,
    });
    return token.access_token;
  }

  async function resolverAcesso(empresaId: string): Promise<string> {
    const conexao = await conexoes.obter(empresaId);
    if (!conexao) throw new ErroBlingNaoConectado();
    if (conexao.accessExpiraEm.getTime() - relogio().getTime() >= MARGEM_REFRESH_MS)
      return conexao.accessToken;
    return renovar(empresaId, conexao.refreshToken);
  }

  return {
    async urlAutorizacao(empresaId, usuarioId) {
      const agora = emSegundos(relogio());
      const state = await new SignJWT({ empresa: empresaId })
        .setProtectedHeader({ alg: ALGORITMO, typ: 'JWT' })
        .setSubject(usuarioId)
        .setIssuer(EMISSOR)
        .setAudience(PUBLICO_STATE)
        .setIssuedAt(agora)
        .setExpirationTime(agora + DURACAO_STATE_MS / 1000)
        .sign(chave);
      const busca = new URLSearchParams({
        response_type: 'code',
        client_id: config.clientId,
        state,
      });
      return `${URL_AUTORIZACAO_BLING}?${busca}`;
    },

    async concluir(code, state) {
      let claims: z.infer<typeof EsquemaClaimsState>;
      try {
        const { payload } = await jwtVerify(state, chave, {
          algorithms: [ALGORITMO],
          issuer: EMISSOR,
          audience: PUBLICO_STATE,
          currentDate: relogio(),
          requiredClaims: ['sub', 'exp', 'iat'],
        });
        claims = EsquemaClaimsState.parse(payload);
      } catch (erro) {
        if (erro instanceof errors.JOSEError || erro instanceof z.ZodError)
          throw new ErroBlingStateInvalido();
        throw erro;
      }

      const token = await cliente.token({ grant_type: 'authorization_code', code }, credenciais);
      await conexoes.salvar(claims.empresa, {
        accessToken: token.access_token,
        accessExpiraEm: expiracao(token),
        refreshToken: token.refresh_token,
        usuarioId: claims.sub,
      });
      return { empresaId: claims.empresa, usuarioId: claims.sub };
    },

    acessoValido(empresaId) {
      const pendente = pendentes.get(empresaId);
      if (pendente) return pendente;
      const resolucao = resolverAcesso(empresaId).finally(() => pendentes.delete(empresaId));
      pendentes.set(empresaId, resolucao);
      return resolucao;
    },
  };
}
