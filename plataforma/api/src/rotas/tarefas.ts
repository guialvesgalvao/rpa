import multipart from '@fastify/multipart';
import {
  COMENTARIO_TAREFA_MAX,
  type ComentarioTarefa,
  type ContagemTarefas,
  EsquemaConsultaTarefas,
  EsquemaDefinirResponsavelAutomatico,
  EsquemaMudancaStatus,
  EsquemaNovoComentario,
  type EventoTarefa,
  type ResponsavelAutomatico,
  type Tarefa,
  type TarefaDetalhe,
  temPermissao,
} from '@plataforma/contratos';
import type { FastifyInstance, FastifyRequest } from 'fastify';

import { buscarCliente, buscarProduto, ehUuid, idDaEmpresa } from '../artes/repositorio.js';
import type { ArmazemArquivos } from '../arquivos/armazem.js';
import { ARMAZEM_BANCO } from '../arquivos/banco.js';
import { disposicaoAnexo, lerArquivo } from '../arquivos/repositorio.js';
import type { Banco } from '../db/cliente.js';
import { ErroApi, lerCorpo } from '../erros.js';
import { usuarioDe } from '../plugins/autenticacao.js';
import {
  type Acesso,
  anexoDoComentario,
  comentar,
  concluirTarefa,
  contarPorStatus,
  criarTarefa,
  detalharTarefa,
  historicoDaTarefa,
  listarTarefas,
  mudarStatus,
  obterTarefa,
} from '../tarefas/servico.js';
import {
  definirResponsavelAutomatico,
  obterResponsavelAutomatico,
} from '../tarefas/responsavel.js';
import { conferirNovaArte, exigirIds, LIMITES_MULTIPART, lerCampos } from './artes.js';
import { lerComentarioMultipart } from './multipart-comentario.js';

const tarefaNaoEncontrada = () =>
  new ErroApi(404, 'tarefa_nao_encontrada', 'Tarefa não encontrada.');

// Tarefas de desenvolvimento de arte. Admin e arte finalista usam todas as rotas; o arte finalista só alcança
// as tarefas de que é responsável (as outras respondem 404).
export function rotasTarefas(
  app: FastifyInstance,
  { db, armazem = ARMAZEM_BANCO }: { db: Banco; armazem?: ArmazemArquivos },
): void {
  // Registro encapsulado: o parser multipart (conclusão com a arte) vale só para estas rotas.
  void app.register(async (escopo) => {
    await escopo.register(multipart, { limits: LIMITES_MULTIPART });

    const { exigirUsuario, exigirEmpresa, exigirPermissao } = escopo.autenticacao;
    const daEmpresa = [exigirUsuario, exigirEmpresa('empresa')];
    const preHandler = [...daEmpresa, exigirPermissao('artes')];
    // Criar a tarefa e concluí-la (o que cadastra a arte) é de quem pode adicionar artes.
    const cadastro = [...daEmpresa, exigirPermissao('artes.adicionar')];

    // Empresa do token que não existe no banco: tratada como inexistente.
    async function empresaDe(request: FastifyRequest): Promise<string> {
      const { empresa } = request.params as { empresa: string };
      const id = await idDaEmpresa(db, empresa);
      if (!id) throw new ErroApi(404, 'empresa_nao_encontrada', 'Empresa não encontrada.');
      return id;
    }

    const acessoDe = (request: FastifyRequest): Acesso => {
      const { usuarioId, permissoes } = usuarioDe(request);
      const { empresa } = request.params as { empresa: string };
      return { usuarioId, veTodas: temPermissao(permissoes[empresa], 'artes.acompanhar') };
    };

    function tarefaIdDe(request: FastifyRequest): string {
      const { id } = request.params as { id: string };
      if (!ehUuid(id)) throw tarefaNaoEncontrada();
      return id;
    }

    escopo.post(
      '/v1/empresas/:empresa/clientes/:id/produtos/:produtoId/tarefas',
      { preHandler: cadastro },
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

    // Responsável pelas tarefas automáticas da empresa: só quem acompanha todas as tarefas vê e muda.
    const soAdmin = [...daEmpresa, exigirPermissao('artes.acompanhar')];

    escopo.get(
      '/v1/empresas/:empresa/tarefas/responsavel-automatico',
      { preHandler: soAdmin },
      async (request): Promise<ResponsavelAutomatico> =>
        obterResponsavelAutomatico(db, await empresaDe(request)),
    );

    escopo.put(
      '/v1/empresas/:empresa/tarefas/responsavel-automatico',
      { preHandler: soAdmin },
      async (request): Promise<ResponsavelAutomatico> => {
        const { responsavelId } = lerCorpo(EsquemaDefinirResponsavelAutomatico, request.body);
        return definirResponsavelAutomatico(db, await empresaDe(request), responsavelId);
      },
    );

    // Contadores dos atalhos da home de Artes.
    escopo.get(
      '/v1/empresas/:empresa/tarefas/contagem',
      { preHandler },
      async (request): Promise<ContagemTarefas> =>
        contarPorStatus(db, await empresaDe(request), acessoDe(request)),
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
      { preHandler: cadastro },
      async (request): Promise<Tarefa> => {
        const empresaId = await empresaDe(request);
        const tarefaId = tarefaIdDe(request);
        const acesso = acessoDe(request);
        const atual = await obterTarefa(db, empresaId, tarefaId, acesso);
        if (!atual) throw tarefaNaoEncontrada();

        const campos = await lerCampos(request);
        exigirIds(campos);
        conferirNovaArte(campos, atual.produto.id);
        const tarefa = await concluirTarefa(
          db,
          {
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
          },
          { armazem, log: request.log },
        );
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
        // JSON (só texto) ou multipart (texto e anexos).
        const { texto, anexos } = request.isMultipart()
          ? await lerComentarioMultipart(request, COMENTARIO_TAREFA_MAX)
          : { ...lerCorpo(EsquemaNovoComentario, request.body), anexos: [] };
        const comentario = await comentar(
          db,
          { empresaId, tarefaId, acesso: acessoDe(request), texto, anexos },
          { armazem, log: request.log },
        );
        if (!comentario) throw tarefaNaoEncontrada();
        return reply.code(201).send(comentario);
      },
    );

    // Download do anexo, com o mesmo alcance da tarefa (o arte finalista de outra tarefa recebe 404).
    escopo.get(
      '/v1/empresas/:empresa/tarefas/:id/comentarios/:comentarioId/anexos/:anexoId',
      { preHandler },
      async (request, reply) => {
        const empresaId = await empresaDe(request);
        const tarefaId = tarefaIdDe(request);
        const { comentarioId, anexoId } = request.params as {
          comentarioId: string;
          anexoId: string;
        };
        const naoEncontrado = () =>
          new ErroApi(404, 'anexo_nao_encontrado', 'Anexo não encontrado.');
        if (!ehUuid(comentarioId) || !ehUuid(anexoId)) throw naoEncontrado();
        const arquivoId = await anexoDoComentario(db, {
          empresaId,
          tarefaId,
          comentarioId,
          anexoId,
          acesso: acessoDe(request),
        });
        const arquivo = arquivoId ? await lerArquivo(db, armazem, arquivoId) : null;
        if (!arquivo) throw naoEncontrado();
        return reply
          .header('content-type', arquivo.tipoMime)
          .header('content-length', arquivo.tamanho)
          .header('content-disposition', disposicaoAnexo(arquivo.nomeOriginal))
          .header('x-content-type-options', 'nosniff')
          .header('cache-control', 'private, no-cache')
          .send(arquivo.corpo);
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
