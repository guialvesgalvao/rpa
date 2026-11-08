import {
  EsquemaNovoUsuario,
  podeAtribuirEmpresas,
  type UsuarioResumo,
} from '@plataforma/contratos';
import type { FastifyInstance, FastifyRequest } from 'fastify';

import type { Banco } from '../db/cliente.js';
import { ErroApi, lerCorpo } from '../erros.js';
import { usuarioDe } from '../plugins/autenticacao.js';
import {
  buscarPerfil,
  criarUsuario,
  ErroUsuario,
  listarDoEscopo,
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

// Usuários pela tela (admin): lista e cria só dentro das empresas do próprio admin. Editar, desativar e trocar
// a senha de outro usuário continuam na CLI.
export function rotasUsuarios(app: FastifyInstance, { db }: { db: Banco }): void {
  const preHandler = [app.autenticacao.exigirUsuario, app.autenticacao.exigirPerfil('admin')];

  // Empresas do admin lidas do banco: o token pode estar até 15 min desatualizado.
  async function empresasDoAdmin(request: FastifyRequest): Promise<string[]> {
    const perfil = await buscarPerfil(db, usuarioDe(request).usuarioId);
    if (!perfil?.ativo) throw new ErroApi(401, 'token_invalido', 'Token de acesso inválido.');
    if (perfil.perfil !== 'admin') {
      throw new ErroApi(403, 'perfil_proibido', 'Seu perfil não permite esta ação.');
    }
    return perfil.empresas.map((empresa) => empresa.slug);
  }

  app.get('/v1/usuarios', { preHandler }, async (request): Promise<UsuarioResumo[]> => {
    const usuarios = await listarDoEscopo(db, await empresasDoAdmin(request));
    return usuarios.map(paraResumo);
  });

  app.post('/v1/usuarios', { preHandler }, async (request, reply): Promise<UsuarioResumo> => {
    const novo = lerCorpo(EsquemaNovoUsuario, request.body);
    if (!podeAtribuirEmpresas(await empresasDoAdmin(request), novo.empresas)) {
      throw new ErroApi(403, 'empresa_proibida', 'Sem acesso a uma das empresas escolhidas.');
    }
    try {
      const criado = await criarUsuario(db, { ...novo, deveTrocarSenha: true });
      request.log.info({ usuarioId: criado.id, perfil: criado.perfil }, 'Usuário criado pela tela');
      return reply.code(201).send(paraResumo(criado));
    } catch (erro) {
      if (erro instanceof ErroUsuario) {
        throw erro.codigo === 'email_em_uso'
          ? new ErroApi(409, 'email_em_uso', erro.message)
          : new ErroApi(400, 'requisicao_invalida', erro.message);
      }
      throw erro;
    }
  });
}
