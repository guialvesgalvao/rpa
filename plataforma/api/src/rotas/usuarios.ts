import {
  EsquemaNovoUsuario,
  EsquemaTrocaSenha,
  type Permissao,
  podeAtribuirEmpresas,
  temPermissao,
  type UsuarioResumo,
} from '@plataforma/contratos';
import type { FastifyInstance, FastifyRequest } from 'fastify';

import type { Limite } from '../auth/limite.js';
import type { Banco } from '../db/cliente.js';
import { ErroApi, lerCorpo } from '../erros.js';
import { usuarioDe } from '../plugins/autenticacao.js';
import {
  criarUsuario,
  ErroUsuario,
  listarDoEscopo,
  trocarSenha,
  type UsuarioListado,
} from '../usuarios/servico.js';

const paraResumo = ({ id, nome, email, perfil, ativo, empresas, criadoEm }: UsuarioListado) => ({
  id,
  nome,
  email,
  perfil,
  ativo,
  empresas,
  criadoEm: criadoEm.toISOString(),
});

// Usuários pela tela: lista e cria só dentro das empresas em que quem pede tem a permissão.
export function rotasUsuarios(
  app: FastifyInstance,
  { db, limite }: { db: Banco; limite: Limite },
): void {
  const { exigirUsuario, exigirPermissaoEmAlgumaEmpresa } = app.autenticacao;

  // Empresas em que quem pede tem todas as permissões informadas (lidas do banco nesta requisição).
  function empresasCom(request: FastifyRequest, ...chaves: Permissao[]): string[] {
    return Object.entries(usuarioDe(request).permissoes)
      .filter(([, permissoes]) => chaves.every((chave) => temPermissao(permissoes, chave)))
      .map(([slug]) => slug);
  }

  // Rotas do app anterior às permissões (ADR 0011): sem empresa no caminho e com `perfil` no corpo.
  app.get(
    '/v1/usuarios',
    { preHandler: [exigirUsuario, exigirPermissaoEmAlgumaEmpresa('usuarios')] },
    async (request): Promise<UsuarioResumo[]> => {
      const usuarios = await listarDoEscopo(db, empresasCom(request, 'usuarios'));
      return usuarios.map(paraResumo);
    },
  );

  // Como `perfil` vira permissões, criar por aqui exige poder criar usuários e também editar permissões.
  const criacao = [
    exigirUsuario,
    exigirPermissaoEmAlgumaEmpresa('usuarios.editar'),
    exigirPermissaoEmAlgumaEmpresa('usuarios.permissoes'),
  ];
  app.post(
    '/v1/usuarios',
    { preHandler: criacao },
    async (request, reply): Promise<UsuarioResumo> => {
      const novo = lerCorpo(EsquemaNovoUsuario, request.body);
      const permitidas = empresasCom(request, 'usuarios.editar', 'usuarios.permissoes');
      if (!podeAtribuirEmpresas(permitidas, novo.empresas)) {
        throw new ErroApi(403, 'empresa_proibida', 'Sem acesso a uma das empresas escolhidas.');
      }
      try {
        const criado = await criarUsuario(db, { ...novo, deveTrocarSenha: true });
        request.log.info(
          { usuarioId: criado.id, perfil: criado.perfil },
          'Usuário criado pela tela',
        );
        return reply.code(201).send(paraResumo(criado));
      } catch (erro) {
        if (erro instanceof ErroUsuario) {
          throw erro.codigo === 'email_em_uso'
            ? new ErroApi(409, 'email_em_uso', erro.message)
            : new ErroApi(400, 'requisicao_invalida', erro.message);
        }
        throw erro;
      }
    },
  );

  // Troca da própria senha (qualquer perfil). Não há bloqueio nas outras rotas: quem pede a troca é a tela.
  app.post(
    '/v1/eu/senha',
    { preHandler: app.autenticacao.exigirUsuario },
    async (request, reply) => {
      const { senhaAtual, novaSenha, renovacao } = lerCorpo(EsquemaTrocaSenha, request.body);
      const { usuarioId } = usuarioDe(request);
      const chave = `troca-senha:${usuarioId}`;
      if (limite.bloqueado(chave)) {
        throw new ErroApi(429, 'muitas_tentativas', 'Muitas tentativas; aguarde alguns minutos.');
      }
      limite.registrarTentativa(chave);
      try {
        await trocarSenha(db, {
          usuarioId,
          senhaAtual,
          novaSenha,
          ...(renovacao ? { manterRenovacao: renovacao } : {}),
        });
      } catch (erro) {
        if (erro instanceof ErroUsuario)
          throw new ErroApi(400, erro.codigo ?? 'requisicao_invalida', erro.message);
        throw erro;
      }
      limite.limpar(chave);
      request.log.info({ usuarioId }, 'Senha trocada pelo usuário');
      return reply.code(204).send();
    },
  );
}
