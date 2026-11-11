import {
  EsquemaCriacaoUsuario,
  EsquemaEdicaoUsuario,
  EsquemaNovoUsuario,
  EsquemaPermissoesUsuario,
  EsquemaTrocaSenha,
  type Permissao,
  podeAtribuirEmpresas,
  temPermissao,
  type UsuarioDetalhe,
  type UsuarioResumo,
} from '@plataforma/contratos';
import type { FastifyInstance, FastifyRequest } from 'fastify';

import type { Limite } from '../auth/limite.js';
import { ehUuid } from '../artes/repositorio.js';
import type { Banco } from '../db/cliente.js';
import { ErroApi, lerCorpo } from '../erros.js';
import { usuarioDe } from '../plugins/autenticacao.js';
import {
  criarUsuario,
  definirPermissoes,
  editarUsuario,
  ErroUsuario,
  excluirUsuario,
  listar,
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

  const paraDetalhe = (usuario: UsuarioListado): UsuarioDetalhe => ({
    id: usuario.id,
    nome: usuario.nome,
    email: usuario.email,
    area: usuario.area,
    ativo: usuario.ativo,
    empresas: usuario.empresas.map((slug) => ({
      slug,
      permissoes: usuario.permissoes[slug] ?? [],
    })),
    criadoEm: usuario.criadoEm.toISOString(),
  });

  const paraErroApi = (erro: unknown): unknown => {
    if (!(erro instanceof ErroUsuario)) return erro;
    if (erro.codigo === 'email_em_uso') return new ErroApi(409, 'email_em_uso', erro.message);
    if (erro.codigo === 'ultimo_administrador')
      return new ErroApi(409, 'ultimo_administrador', erro.message);
    if (erro.codigo === 'usuario_nao_encontrado') return usuarioNaoEncontrado();
    return new ErroApi(400, 'requisicao_invalida', erro.message);
  };

  const usuarioNaoEncontrado = () =>
    new ErroApi(404, 'usuario_nao_encontrado', 'Usuário não encontrado.');

  // --- Painel de usuários por empresa (ADR 0011) ---
  const { exigirEmpresa, exigirPermissao } = app.autenticacao;
  const daEmpresa = [exigirUsuario, exigirEmpresa('empresa')];
  const BASE = '/v1/empresas/:empresa/usuarios';

  // O usuário da rota, se for desta empresa. De outra empresa, excluído ou inexistente: 404.
  async function alvoDe(request: FastifyRequest): Promise<UsuarioListado> {
    const { empresa, id } = request.params as { empresa: string; id: string };
    const [alvo] = ehUuid(id) ? await listar(db, id) : [];
    if (!alvo || !alvo.empresas.includes(empresa)) throw usuarioNaoEncontrado();
    return alvo;
  }

  // Nome, e-mail, área, empresas e a exclusão valem para o usuário inteiro: só mexe quem pode editar usuários
  // em todas as empresas dele.
  function exigirTodasAsEmpresas(request: FastifyRequest, alvo: UsuarioListado): void {
    const permitidas = empresasCom(request, 'usuarios.editar');
    if (!alvo.empresas.every((slug) => permitidas.includes(slug))) {
      throw new ErroApi(
        403,
        'empresa_proibida',
        'Este usuário também pertence a uma empresa em que você não pode editar usuários.',
      );
    }
  }

  app.get(
    BASE,
    { preHandler: [...daEmpresa, exigirPermissao('usuarios')] },
    async (request): Promise<UsuarioDetalhe[]> => {
      const { empresa } = request.params as { empresa: string };
      const todos = await listar(db);
      return todos.filter((usuario) => usuario.empresas.includes(empresa)).map(paraDetalhe);
    },
  );

  app.post(
    BASE,
    { preHandler: [...daEmpresa, exigirPermissao('usuarios.editar')] },
    async (request, reply): Promise<UsuarioDetalhe> => {
      const novo = lerCorpo(EsquemaCriacaoUsuario, request.body);
      if (!podeAtribuirEmpresas(empresasCom(request, 'usuarios.editar'), novo.empresas)) {
        throw new ErroApi(403, 'empresa_proibida', 'Sem acesso a uma das empresas escolhidas.');
      }
      // Permissões só de quem pode editá-las, e só nas empresas do usuário novo.
      const podeDar = empresasCom(request, 'usuarios.permissoes');
      for (const [slug, permissoes] of Object.entries(novo.permissoes)) {
        if (permissoes.length === 0) continue;
        if (!novo.empresas.includes(slug) || !podeDar.includes(slug)) {
          throw new ErroApi(
            403,
            'permissao_proibida',
            'Você não pode definir permissões de usuários nesta empresa.',
          );
        }
      }
      try {
        const criado = await criarUsuario(db, { ...novo, deveTrocarSenha: true });
        request.log.info({ usuarioId: criado.id }, 'Usuário criado pelo painel');
        return await reply.code(201).send(paraDetalhe(criado));
      } catch (erro) {
        throw paraErroApi(erro);
      }
    },
  );

  app.patch(
    `${BASE}/:id`,
    { preHandler: [...daEmpresa, exigirPermissao('usuarios.editar')] },
    async (request): Promise<UsuarioDetalhe> => {
      const dados = lerCorpo(EsquemaEdicaoUsuario, request.body);
      const alvo = await alvoDe(request);
      exigirTodasAsEmpresas(request, alvo);
      if (
        dados.empresas &&
        !podeAtribuirEmpresas(empresasCom(request, 'usuarios.editar'), dados.empresas)
      ) {
        throw new ErroApi(403, 'empresa_proibida', 'Sem acesso a uma das empresas escolhidas.');
      }
      try {
        const editado = await editarUsuario(db, alvo.id, dados);
        request.log.info({ usuarioId: alvo.id }, 'Usuário editado pelo painel');
        return paraDetalhe(editado);
      } catch (erro) {
        throw paraErroApi(erro);
      }
    },
  );

  app.patch(
    `${BASE}/:id/permissoes`,
    { preHandler: [...daEmpresa, exigirPermissao('usuarios.permissoes')] },
    async (request): Promise<UsuarioDetalhe> => {
      const { permissoes } = lerCorpo(EsquemaPermissoesUsuario, request.body);
      const { empresa } = request.params as { empresa: string };
      const alvo = await alvoDe(request);
      const tiraDeSi =
        alvo.id === usuarioDe(request).usuarioId &&
        !temPermissao(permissoes, 'usuarios.permissoes');
      if (tiraDeSi) {
        throw new ErroApi(
          409,
          'propria_permissao',
          'Você não pode tirar de si mesmo a permissão de editar permissões.',
        );
      }
      try {
        const editado = await definirPermissoes(db, alvo.id, empresa, permissoes);
        request.log.info({ usuarioId: alvo.id, empresa }, 'Permissões alteradas pelo painel');
        return paraDetalhe(editado);
      } catch (erro) {
        throw paraErroApi(erro);
      }
    },
  );

  app.delete(
    `${BASE}/:id`,
    { preHandler: [...daEmpresa, exigirPermissao('usuarios.editar')] },
    async (request, reply) => {
      const alvo = await alvoDe(request);
      if (alvo.id === usuarioDe(request).usuarioId) {
        throw new ErroApi(409, 'proprio_usuario', 'Você não pode excluir o seu próprio usuário.');
      }
      exigirTodasAsEmpresas(request, alvo);
      try {
        await excluirUsuario(db, alvo.id);
      } catch (erro) {
        throw paraErroApi(erro);
      }
      request.log.info({ usuarioId: alvo.id }, 'Usuário excluído pelo painel');
      return reply.code(204).send();
    },
  );

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
