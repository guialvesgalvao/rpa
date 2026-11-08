import multipart from '@fastify/multipart';
import {
  ANEXOS_POR_COMENTARIO,
  COMENTARIO_TAREFA_MAX,
  type ComentarioTarefa,
  type ContagemTarefas,
  EsquemaConsultaTarefas,
  EsquemaMudancaStatus,
  EsquemaNovoComentario,
  type EventoTarefa,
  type Tarefa,
  type TarefaDetalhe,
  detectarTipo,
  LIMITES,
} from '@plataforma/contratos';
import type { FastifyInstance, FastifyRequest } from 'fastify';

import { buscarCliente, buscarProduto, ehUuid, idDaEmpresa } from '../artes/repositorio.js';
import type { ArmazemArquivos, ArquivoRecebido } from '../arquivos/armazem.js';
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
import { conferirNovaArte, exigirIds, LIMITES_MULTIPART, lerCampos } from './artes.js';

const tarefaNaoEncontrada = () =>
  new ErroApi(404, 'tarefa_nao_encontrada', 'Tarefa não encontrada.');

const MB = 1024 * 1024;

// Comentário em multipart: `texto` (opcional com anexo) e até 5 `anexos` (PDF ou imagem, com os limites e a
// detecção de tipo das artes). Um arquivo a mais que o limite é lido só para responder 400.
async function lerComentarioMultipart(
  request: FastifyRequest,
): Promise<{ texto: string; anexos: ArquivoRecebido[] }> {
  let texto = '';
  const anexos: ArquivoRecebido[] = [];
  const partes = request.parts({
    limits: { fileSize: LIMITES.pdfBytes, files: ANEXOS_POR_COMENTARIO + 1, fields: 2, parts: 10 },
  });
  for await (const parte of partes) {
    if (parte.type === 'field') {
      if (parte.fieldname !== 'texto') {
        throw new ErroApi(400, 'requisicao_invalida', `Requisição inválida (${parte.fieldname}).`);
      }
      texto = String(parte.value).trim();
      continue;
    }
    if (parte.fieldname !== 'anexos') {
      parte.file.resume();
      throw new ErroApi(400, 'requisicao_invalida', `Requisição inválida (${parte.fieldname}).`);
    }
    if (anexos.length >= ANEXOS_POR_COMENTARIO) {
      parte.file.resume();
      throw new ErroApi(
        400,
        'anexos_demais',
        `Anexe no máximo ${ANEXOS_POR_COMENTARIO} arquivos por comentário.`,
      );
    }
    let conteudo: Buffer;
    try {
      conteudo = await parte.toBuffer();
    } catch (erro) {
      if ((erro as { code?: string }).code === 'FST_REQ_FILE_TOO_LARGE') {
        throw new ErroApi(413, 'arquivo_grande', `O PDF passa de ${LIMITES.pdfBytes / MB} MB.`);
      }
      throw erro;
    }
    // Campo de arquivo sem seleção (formulário HTML): vem sem nome e sem bytes.
    if (!parte.filename && conteudo.length === 0) continue;
    const detectado = detectarTipo(conteudo);
    if (!detectado) {
      throw new ErroApi(
        415,
        'tipo_nao_suportado',
        'O anexo precisa ser PDF ou imagem PNG, JPEG ou WebP.',
      );
    }
    if (detectado.tipo === 'imagem' && conteudo.length > LIMITES.imagemBytes) {
      throw new ErroApi(
        413,
        'arquivo_grande',
        `O arquivo de imagem passa de ${LIMITES.imagemBytes / MB} MB.`,
      );
    }
    anexos.push({
      nomeOriginal: parte.filename || `anexo-${anexos.length + 1}`,
      tipoMime: detectado.mime,
      conteudo,
    });
  }
  if (texto.length > COMENTARIO_TAREFA_MAX) {
    throw new ErroApi(400, 'requisicao_invalida', 'Requisição inválida (texto).');
  }
  return { texto, anexos };
}

// Tarefas de desenvolvimento de arte. Admin e arte finalista usam todas as rotas; o arte finalista só alcança
// as tarefas de que é responsável (as outras respondem 404).
export function rotasTarefas(
  app: FastifyInstance,
  { db, armazem = ARMAZEM_BANCO }: { db: Banco; armazem?: ArmazemArquivos },
): void {
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
          ? await lerComentarioMultipart(request)
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
