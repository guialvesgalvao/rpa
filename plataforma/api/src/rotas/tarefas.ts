import multipart from '@fastify/multipart';
import {
  type ComentarioTarefa,
  EsquemaConsultaTarefas,
  EsquemaMudancaStatus,
  EsquemaNovoComentario,
  type EventoTarefa,
  type Tarefa,
  type TarefaDetalhe,
} from '@plataforma/contratos';
import type { FastifyInstance, FastifyRequest } from 'fastify';

import { buscarCliente, buscarProduto, ehUuid, idDaEmpresa } from '../artes/repositorio.js';
import type { Banco } from '../db/cliente.js';
import { ErroApi, lerCorpo } from '../erros.js';
import { usuarioDe } from '../plugins/autenticacao.js';
import {
  type Acesso,
  comentar,
  concluirTarefa,
  criarTarefa,
  detalharTarefa,
  historicoDaTarefa,
  listarTarefas,
  mudarStatus,
  obterTarefa,
} from '../tarefas/servico.js';
import { conferirNovaArte, exigirIds, LIMITES_MULTIPART, lerCampos } from './artes.js';

const tarefaNaoEncontrada = () =>
  new ErroApi(404, 'tarefa_nao_encontrada', 'Tarefa não encontrada.');

// Tarefas de desenvolvimento de arte. Admin e arte finalista usam todas as rotas; o arte finalista só alcança
// as tarefas de que é responsável (as outras respondem 404).
export function rotasTarefas(app: FastifyInstance, { db }: { db: Banco }): void {
  // Registro encapsulado: o parser multipart (conclusão com a arte) vale só para estas rotas.
  void app.register(async (escopo) => {
    await escopo.register(multipart, { limits: LIMITES_MULTIPART });

    const preHandler = [
      escopo.autenticacao.exigirUsuario,
      escopo.autenticacao.exigirEmpresa('empresa'),
      escopo.autenticacao.exigirPerfil('admin', 'arte_finalista'),
    ];

    // Empresa do token que não existe no banco: tratada como inexistente.
    async function empresaDe(request: FastifyRequest): Promise<string> {
      const { empresa } = request.params as { empresa: string };
      const id = await idDaEmpresa(db, empresa);
      if (!id) throw new ErroApi(404, 'empresa_nao_encontrada', 'Empresa não encontrada.');
      return id;
    }

    const acessoDe = (request: FastifyRequest): Acesso => {
      const { usuarioId, perfil } = usuarioDe(request);
      return { usuarioId, perfil };
    };

    function tarefaIdDe(request: FastifyRequest): string {
      const { id } = request.params as { id: string };
      if (!ehUuid(id)) throw tarefaNaoEncontrada();
      return id;
    }

    escopo.post(
      '/v1/empresas/:empresa/clientes/:id/produtos/:produtoId/tarefas',
      { preHandler },
      async (request, reply): Promise<Tarefa> => {
        const empresaId = await empresaDe(request);
        const { id, produtoId } = request.params as { id: string; produtoId: string };
        const cliente = ehUuid(id) ? await buscarCliente(db, empresaId, id) : null;
        if (!cliente) throw new ErroApi(404, 'cliente_nao_encontrado', 'Cliente não encontrado.');
        const produto = ehUuid(produtoId) ? await buscarProduto(db, empresaId, produtoId) : null;
        if (!produto) throw new ErroApi(404, 'produto_nao_encontrado', 'Produto não encontrado.');
        const tarefa = await criarTarefa(db, {
          empresaId,
          clienteId: cliente.id,
          produtoId: produto.id,
          usuarioId: usuarioDe(request).usuarioId,
        });
        return reply.code(201).send(tarefa);
      },
    );

    escopo.get(
      '/v1/empresas/:empresa/tarefas',
      { preHandler },
      async (request): Promise<Tarefa[]> => {
        const consulta = lerCorpo(EsquemaConsultaTarefas, request.query);
        return listarTarefas(db, await empresaDe(request), acessoDe(request), consulta);
      },
    );

    escopo.get(
      '/v1/empresas/:empresa/tarefas/:id',
      { preHandler },
      async (request): Promise<TarefaDetalhe> => {
        const empresaId = await empresaDe(request);
        const tarefa = await detalharTarefa(db, empresaId, tarefaIdDe(request), acessoDe(request));
        if (!tarefa) throw tarefaNaoEncontrada();
        return tarefa;
      },
    );

    escopo.patch(
      '/v1/empresas/:empresa/tarefas/:id/status',
      { preHandler },
      async (request): Promise<Tarefa> => {
        const empresaId = await empresaDe(request);
        const tarefaId = tarefaIdDe(request);
        const { status } = lerCorpo(EsquemaMudancaStatus, request.body);
        const tarefa = await mudarStatus(db, {
          empresaId,
          tarefaId,
          acesso: acessoDe(request),
          status,
        });
        if (!tarefa) throw tarefaNaoEncontrada();
        return tarefa;
      },
    );

    // Multipart com os mesmos campos do cadastro de arte; cliente e produto são os da tarefa.
    escopo.post(
      '/v1/empresas/:empresa/tarefas/:id/concluir',
      { preHandler },
      async (request): Promise<Tarefa> => {
        const empresaId = await empresaDe(request);
        const tarefaId = tarefaIdDe(request);
        const acesso = acessoDe(request);
        const atual = await obterTarefa(db, empresaId, tarefaId, acesso);
        if (!atual) throw tarefaNaoEncontrada();

        const campos = await lerCampos(request);
        exigirIds(campos);
        conferirNovaArte(campos, atual.produto.id);
        const tarefa = await concluirTarefa(db, {
          empresaId,
          tarefaId,
          acesso,
          arte: {
            nome: campos.nome,
            corId: campos.corId ?? '',
            maquinaIds: campos.maquinaIds ?? [],
            pdf: campos.pdf,
            imagem: campos.imagem,
          },
        });
        if (!tarefa) throw tarefaNaoEncontrada();
        return tarefa;
      },
    );

    escopo.post(
      '/v1/empresas/:empresa/tarefas/:id/comentarios',
      { preHandler },
      async (request, reply): Promise<ComentarioTarefa> => {
        const empresaId = await empresaDe(request);
        const tarefaId = tarefaIdDe(request);
        const { texto } = lerCorpo(EsquemaNovoComentario, request.body);
        const comentario = await comentar(db, {
          empresaId,
          tarefaId,
          acesso: acessoDe(request),
          texto,
        });
        if (!comentario) throw tarefaNaoEncontrada();
        return reply.code(201).send(comentario);
      },
    );

    escopo.get(
      '/v1/empresas/:empresa/tarefas/:id/historico',
      { preHandler },
      async (request): Promise<EventoTarefa[]> => {
        const empresaId = await empresaDe(request);
        const eventos = await historicoDaTarefa(
          db,
          empresaId,
          tarefaIdDe(request),
          acessoDe(request),
        );
        if (!eventos) throw tarefaNaoEncontrada();
        return eventos;
      },
    );
  });
}
