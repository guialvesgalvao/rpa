import multipart from '@fastify/multipart';
import {
  COMENTARIO_COMPRA_MAX,
  type ComentarioCompra,
  empresaTemCompras,
  EsquemaConsultaCompras,
  EsquemaEdicaoPedidoCompra,
  EsquemaMudancaStatusCompra,
  EsquemaNovoComentarioCompra,
  EsquemaNovoPedidoCompra,
  type EventoCompra,
  type Insumo,
  type PedidoCompra,
  type PedidoCompraDetalhe,
  temPermissao,
} from '@plataforma/contratos';
import type { FastifyInstance, FastifyRequest } from 'fastify';

import { ehUuid, idDaEmpresa } from '../artes/repositorio.js';
import type { ArmazemArquivos } from '../arquivos/armazem.js';
import { ARMAZEM_BANCO } from '../arquivos/banco.js';
import { disposicaoAnexo, lerArquivo } from '../arquivos/repositorio.js';
import {
  type AcessoCompras,
  anexoDoComentarioDoPedido,
  assumirPedido,
  comentarPedido,
  criarPedido,
  detalharPedido,
  editarPedido,
  historicoDoPedido,
  listarInsumos,
  listarPedidos,
  mudarStatusPedido,
} from '../compras/servico.js';
import type { Banco } from '../db/cliente.js';
import { ErroApi, lerCorpo } from '../erros.js';
import { usuarioDe } from '../plugins/autenticacao.js';
import { LIMITES_MULTIPART } from './artes.js';
import { lerComentarioMultipart } from './multipart-comentario.js';

const pedidoNaoEncontrado = () =>
  new ErroApi(404, 'pedido_nao_encontrado', 'Pedido de compra não encontrado.');

// Pedidos de compra de insumos (ADR 0012), só nas empresas com sincronização do Bling (nas outras, 404). Ver e
// acompanhar o próprio pedido é do módulo (`compras`); criar, de `compras.pedir`; assumir e mudar o status de
// qualquer pedido, de `compras.acompanhar`. Pedido fora do alcance responde 404.
export function rotasCompras(
  app: FastifyInstance,
  { db, armazem = ARMAZEM_BANCO }: { db: Banco; armazem?: ArmazemArquivos },
): void {
  // Registro encapsulado: o parser multipart (comentário com anexos) vale só para estas rotas.
  void app.register(async (escopo) => {
    await escopo.register(multipart, { limits: LIMITES_MULTIPART });

    const { exigirUsuario, exigirEmpresa, exigirPermissao } = escopo.autenticacao;

    const exigirModulo = async (request: FastifyRequest) => {
      const { empresa } = request.params as { empresa: string };
      if (!empresaTemCompras(empresa)) {
        throw new ErroApi(404, 'compras_indisponivel', 'Compras não existe nesta empresa.');
      }
    };
    const daEmpresa = [exigirUsuario, exigirEmpresa('empresa'), exigirModulo];
    const modulo = [...daEmpresa, exigirPermissao('compras')];
    const pedir = [...daEmpresa, exigirPermissao('compras.pedir')];
    const acompanhar = [...daEmpresa, exigirPermissao('compras.acompanhar')];

    // Empresa do token que não existe no banco: tratada como inexistente.
    async function empresaDe(request: FastifyRequest): Promise<string> {
      const { empresa } = request.params as { empresa: string };
      const id = await idDaEmpresa(db, empresa);
      if (!id) throw new ErroApi(404, 'empresa_nao_encontrada', 'Empresa não encontrada.');
      return id;
    }

    const acessoDe = (request: FastifyRequest): AcessoCompras => {
      const { usuarioId, permissoes } = usuarioDe(request);
      const { empresa } = request.params as { empresa: string };
      return {
        usuarioId,
        acompanha: temPermissao(permissoes[empresa], 'compras.acompanhar'),
        pede: temPermissao(permissoes[empresa], 'compras.pedir'),
      };
    };

    function pedidoIdDe(request: FastifyRequest): string {
      const { id } = request.params as { id: string };
      if (!ehUuid(id)) throw pedidoNaoEncontrado();
      return id;
    }

    const base = '/v1/empresas/:empresa/compras';

    escopo.get(`${base}/insumos`, { preHandler: pedir }, async (request): Promise<Insumo[]> =>
      listarInsumos(db, await empresaDe(request)),
    );

    escopo.post(
      `${base}/pedidos`,
      { preHandler: pedir },
      async (request, reply): Promise<PedidoCompra> => {
        const empresaId = await empresaDe(request);
        const novo = lerCorpo(EsquemaNovoPedidoCompra, request.body);
        const pedido = await criarPedido(db, {
          empresaId,
          usuarioId: usuarioDe(request).usuarioId,
          ...novo,
        });
        return reply.code(201).send(pedido);
      },
    );

    escopo.get(
      `${base}/pedidos`,
      { preHandler: modulo },
      async (request): Promise<PedidoCompra[]> => {
        const consulta = lerCorpo(EsquemaConsultaCompras, request.query);
        return listarPedidos(db, await empresaDe(request), acessoDe(request), consulta);
      },
    );

    escopo.get(
      `${base}/pedidos/:id`,
      { preHandler: modulo },
      async (request): Promise<PedidoCompraDetalhe> => {
        const empresaId = await empresaDe(request);
        const pedido = await detalharPedido(db, empresaId, pedidoIdDe(request), acessoDe(request));
        if (!pedido) throw pedidoNaoEncontrado();
        return pedido;
      },
    );

    escopo.patch(
      `${base}/pedidos/:id`,
      { preHandler: modulo },
      async (request): Promise<PedidoCompra> => {
        const empresaId = await empresaDe(request);
        const pedidoId = pedidoIdDe(request);
        const edicao = lerCorpo(EsquemaEdicaoPedidoCompra, request.body);
        const pedido = await editarPedido(db, {
          empresaId,
          pedidoId,
          acesso: acessoDe(request),
          edicao,
        });
        if (!pedido) throw pedidoNaoEncontrado();
        return pedido;
      },
    );

    escopo.post(
      `${base}/pedidos/:id/assumir`,
      { preHandler: acompanhar },
      async (request): Promise<PedidoCompra> => {
        const empresaId = await empresaDe(request);
        const pedido = await assumirPedido(db, {
          empresaId,
          pedidoId: pedidoIdDe(request),
          acesso: acessoDe(request),
        });
        if (!pedido) throw pedidoNaoEncontrado();
        return pedido;
      },
    );

    // Quem acompanha muda para qualquer status; o criador só cancela o próprio pedido ainda Aberto (o serviço confere).
    escopo.patch(
      `${base}/pedidos/:id/status`,
      { preHandler: modulo },
      async (request): Promise<PedidoCompra> => {
        const empresaId = await empresaDe(request);
        const pedidoId = pedidoIdDe(request);
        const { status } = lerCorpo(EsquemaMudancaStatusCompra, request.body);
        const pedido = await mudarStatusPedido(db, {
          empresaId,
          pedidoId,
          acesso: acessoDe(request),
          status,
        });
        if (!pedido) throw pedidoNaoEncontrado();
        return pedido;
      },
    );

    escopo.get(
      `${base}/pedidos/:id/historico`,
      { preHandler: modulo },
      async (request): Promise<EventoCompra[]> => {
        const empresaId = await empresaDe(request);
        const eventos = await historicoDoPedido(
          db,
          empresaId,
          pedidoIdDe(request),
          acessoDe(request),
        );
        if (!eventos) throw pedidoNaoEncontrado();
        return eventos;
      },
    );

    escopo.post(
      `${base}/pedidos/:id/comentarios`,
      { preHandler: modulo },
      async (request, reply): Promise<ComentarioCompra> => {
        const empresaId = await empresaDe(request);
        const pedidoId = pedidoIdDe(request);
        // JSON (só texto) ou multipart (texto e anexos).
        const { texto, anexos } = request.isMultipart()
          ? await lerComentarioMultipart(request, COMENTARIO_COMPRA_MAX)
          : { ...lerCorpo(EsquemaNovoComentarioCompra, request.body), anexos: [] };
        const comentario = await comentarPedido(
          db,
          { empresaId, pedidoId, acesso: acessoDe(request), texto, anexos },
          { armazem, log: request.log },
        );
        if (!comentario) throw pedidoNaoEncontrado();
        return reply.code(201).send(comentario);
      },
    );

    // Download do anexo, com o mesmo alcance do pedido.
    escopo.get(
      `${base}/pedidos/:id/comentarios/:comentarioId/anexos/:anexoId`,
      { preHandler: modulo },
      async (request, reply) => {
        const empresaId = await empresaDe(request);
        const pedidoId = pedidoIdDe(request);
        const { comentarioId, anexoId } = request.params as {
          comentarioId: string;
          anexoId: string;
        };
        const naoEncontrado = () =>
          new ErroApi(404, 'anexo_nao_encontrado', 'Anexo não encontrado.');
        if (!ehUuid(comentarioId) || !ehUuid(anexoId)) throw naoEncontrado();
        const arquivoId = await anexoDoComentarioDoPedido(db, {
          empresaId,
          pedidoId,
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
  });
}
