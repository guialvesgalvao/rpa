import { perfilLegado, type Permissao, temPermissao } from '@plataforma/contratos';
import type { FastifyRequest, preHandlerAsyncHookHandler } from 'fastify';

import type { DadosAcesso, Tokens } from '../auth/tokens.js';
import type { Banco } from '../db/cliente.js';
import { ErroApi } from '../erros.js';
import { buscarAcesso } from '../usuarios/servico.js';

export type UsuarioDaRequisicao = DadosAcesso & { permissoes: Record<string, Permissao[]> };

export type Autenticacao = ReturnType<typeof criarAutenticacao>;

declare module 'fastify' {
  interface FastifyRequest {
    // Preenchido por `exigirUsuario`. As empresas vêm do token de acesso; as permissões (por slug de empresa),
    // do banco, a cada requisição. `perfil` é derivado delas e só existe para o código legado.
    usuario: UsuarioDaRequisicao | null;
  }
  interface FastifyInstance {
    autenticacao: Autenticacao;
  }
}

const BEARER = /^Bearer ([^\s]+)$/i;

const naoAutenticado = () => new ErroApi(401, 'nao_autenticado', 'Faça login para continuar.');

export function usuarioDe(request: FastifyRequest): UsuarioDaRequisicao {
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
    const acesso = await buscarAcesso(db, resultado.dados.usuarioId);
    if (!acesso.ativo) throw new ErroApi(401, 'token_invalido', 'Token de acesso inválido.');
    const perfil = perfilLegado(
      Object.values(acesso.permissoes).map((permissoes) => ({ permissoes })),
    );
    request.usuario = { ...resultado.dados, perfil, permissoes: acesso.permissoes };
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

  const semPermissao = () =>
    new ErroApi(403, 'permissao_proibida', 'Você não tem permissão para esta ação.');

  // A permissão na empresa do parâmetro `param` da rota. Use depois de `exigirEmpresa`.
  const exigirPermissao =
    (chave: Permissao, param = 'empresa'): preHandlerAsyncHookHandler =>
    async (request) => {
      const slug = (request.params as Record<string, unknown>)[param];
      if (typeof slug !== 'string' || !temPermissao(usuarioDe(request).permissoes[slug], chave)) {
        throw semPermissao();
      }
    };

  // Para as rotas sem empresa no caminho: basta ter a permissão em alguma empresa.
  const exigirPermissaoEmAlgumaEmpresa =
    (chave: Permissao): preHandlerAsyncHookHandler =>
    async (request) => {
      const porEmpresa = Object.values(usuarioDe(request).permissoes);
      if (!porEmpresa.some((permissoes) => temPermissao(permissoes, chave))) throw semPermissao();
    };

  return {
    exigirUsuario,
    exigirEmpresa,
    exigirPermissao,
    exigirPermissaoEmAlgumaEmpresa,
  };
}
