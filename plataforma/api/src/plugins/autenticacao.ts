import type { Perfil } from '@plataforma/contratos';
import type { FastifyRequest, preHandlerAsyncHookHandler } from 'fastify';

import type { DadosAcesso, Tokens } from '../auth/tokens.js';
import type { Banco } from '../db/cliente.js';
import { ErroApi } from '../erros.js';
import { usuarioAtivo } from '../usuarios/servico.js';

export type Autenticacao = ReturnType<typeof criarAutenticacao>;

declare module 'fastify' {
  interface FastifyRequest {
    // Preenchido por `exigirUsuario`; perfil e empresas vêm do token de acesso.
    usuario: DadosAcesso | null;
  }
  interface FastifyInstance {
    autenticacao: Autenticacao;
  }
}

const BEARER = /^Bearer ([^\s]+)$/i;

const naoAutenticado = () => new ErroApi(401, 'nao_autenticado', 'Faça login para continuar.');

export function usuarioDe(request: FastifyRequest): DadosAcesso {
  if (!request.usuario) throw naoAutenticado();
  return request.usuario;
}

// Use nos `preHandler` das rotas, sempre com `exigirUsuario` antes dos outros.
export function criarAutenticacao(deps: { db: Banco; tokens: Tokens; relogio: () => Date }) {
  const { db, tokens, relogio } = deps;

  // Bearer válido de um usuário ainda ativo no banco.
  const exigirUsuario: preHandlerAsyncHookHandler = async (request) => {
    const token = BEARER.exec(request.headers.authorization ?? '')?.[1];
    if (!token) throw naoAutenticado();

    const resultado = await tokens.verificar(token, relogio());
    if (!resultado.valido) {
      throw resultado.motivo === 'expirado'
        ? new ErroApi(401, 'token_expirado', 'Acesso expirado; renove a sessão.')
        : new ErroApi(401, 'token_invalido', 'Token de acesso inválido.');
    }
    if (!(await usuarioAtivo(db, resultado.dados.usuarioId))) {
      throw new ErroApi(401, 'token_invalido', 'Token de acesso inválido.');
    }
    request.usuario = resultado.dados;
  };

  // A empresa do parâmetro `param` da rota (slug) precisa estar no token.
  const exigirEmpresa =
    (param: string): preHandlerAsyncHookHandler =>
    async (request) => {
      const { empresas } = usuarioDe(request);
      const slug = (request.params as Record<string, unknown>)[param];
      if (typeof slug !== 'string' || !empresas.includes(slug)) {
        throw new ErroApi(403, 'empresa_proibida', 'Sem acesso a esta empresa.');
      }
    };

  const exigirPerfil =
    (...perfis: Perfil[]): preHandlerAsyncHookHandler =>
    async (request) => {
      if (!perfis.includes(usuarioDe(request).perfil)) {
        throw new ErroApi(403, 'perfil_proibido', 'Seu perfil não permite esta ação.');
      }
    };

  return { exigirUsuario, exigirEmpresa, exigirPerfil };
}
