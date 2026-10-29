import {
  EsquemaEntrar,
  EsquemaRenovacao,
  type Eu,
  type RespostaEntrar,
  type Tokens as TokensResposta,
} from '@plataforma/contratos';
import type { FastifyInstance } from 'fastify';

import type { Limite } from '../auth/limite.js';
import { conferirSenha, gerarHash } from '../auth/senha.js';
import { criarSessao, renovarSessao, revogarSessao } from '../auth/sessoes.js';
import type { Tokens } from '../auth/tokens.js';
import type { Banco } from '../db/cliente.js';
import { ErroApi, lerCorpo } from '../erros.js';
import { usuarioDe } from '../plugins/autenticacao.js';
import { buscarCredenciais, buscarPerfil, type PerfilUsuario } from '../usuarios/servico.js';

export type DepsAuth = { db: Banco; tokens: Tokens; relogio: () => Date; limite: Limite };

// Mesma resposta para e-mail inexistente, senha errada, usuário inativo e limite atingido.
const credenciaisInvalidas = () =>
  new ErroApi(401, 'credenciais_invalidas', 'E-mail ou senha inválidos.');
const sessaoInvalida = () => new ErroApi(401, 'sessao_invalida', 'Sessão inválida ou expirada.');
const semEmpresa = () => new ErroApi(403, 'sem_empresa', 'Usuário sem empresa vinculada.');

// E-mail inexistente também passa por um scrypt: o tempo de resposta não revela quem tem conta.
let hashFicticio: Promise<string> | undefined;
const obterHashFicticio = () => (hashFicticio ??= gerarHash('senha-ficticia-para-tempo-constante'));

const paraEu = ({ id, nome, email, perfil, empresas }: PerfilUsuario): Eu => ({
  id,
  nome,
  email,
  perfil,
  empresas,
});

export function rotasAuth(app: FastifyInstance, { db, tokens, relogio, limite }: DepsAuth): void {
  async function emitirAcesso(usuario: PerfilUsuario, agora: Date) {
    const empresas = usuario.empresas.map((empresa) => empresa.slug);
    const acesso = await tokens.emitir(
      { usuarioId: usuario.id, perfil: usuario.perfil, empresas },
      agora,
    );
    return { acesso: acesso.token, expiraEm: acesso.expiraEm.toISOString() };
  }

  app.post('/v1/auth/entrar', async (request): Promise<RespostaEntrar> => {
    const { email, senha, origem } = lerCorpo(EsquemaEntrar, request.body);

    if (limite.bloqueado(email)) throw credenciaisInvalidas();
    // Conta antes de conferir: tentativas em paralelo não escapam do limite. O sucesso zera a conta.
    limite.registrarTentativa(email);

    const credenciais = await buscarCredenciais(db, email);
    const confere = await conferirSenha(
      senha,
      credenciais?.senhaHash ?? (await obterHashFicticio()),
    );
    if (!credenciais || !confere || !credenciais.ativo) throw credenciaisInvalidas();
    limite.limpar(email);

    const usuario = await buscarPerfil(db, credenciais.id);
    if (!usuario) throw credenciaisInvalidas();
    if (usuario.empresas.length === 0) throw semEmpresa();

    const agora = relogio();
    const renovacao = await criarSessao(db, usuario.id, origem, agora);
    return { ...(await emitirAcesso(usuario, agora)), renovacao, eu: paraEu(usuario) };
  });

  app.post('/v1/auth/renovar', async (request): Promise<TokensResposta> => {
    const { renovacao } = lerCorpo(EsquemaRenovacao, request.body);
    const agora = relogio();

    const resultado = await renovarSessao(db, renovacao, agora);
    if (!resultado.ok) {
      if (resultado.motivo === 'reuso') {
        request.log.warn('Reuso de token de renovação fora da janela de corrida: sessão revogada.');
      }
      throw sessaoInvalida();
    }

    const usuario = await buscarPerfil(db, resultado.usuarioId);
    if (!usuario?.ativo) throw sessaoInvalida();
    if (usuario.empresas.length === 0) throw semEmpresa();
    return { ...(await emitirAcesso(usuario, agora)), renovacao: resultado.renovacao };
  });

  // Idempotente: token desconhecido ou já revogado também responde 204.
  app.post('/v1/auth/sair', async (request, reply) => {
    const { renovacao } = lerCorpo(EsquemaRenovacao, request.body);
    await revogarSessao(db, renovacao, relogio());
    return reply.code(204).send();
  });

  app.get(
    '/v1/eu',
    { preHandler: app.autenticacao.exigirUsuario },
    async (request): Promise<Eu> => {
      const usuario = await buscarPerfil(db, usuarioDe(request).usuarioId);
      if (!usuario?.ativo) throw new ErroApi(401, 'token_invalido', 'Token de acesso inválido.');
      return paraEu(usuario);
    },
  );
}
