import {
  empresaTemCompras,
  EsquemaConsultaCompras,
  EsquemaEdicaoPedidoCompra,
  EsquemaMudancaStatusCompra,
  EsquemaNovoPedidoCompra,
  type EventoCompra,
  type Insumo,
  type PedidoCompra,
  temPermissao,
} from '@plataforma/contratos';
import type { FastifyInstance, FastifyRequest } from 'fastify';

import { ehUuid, idDaEmpresa } from '../artes/repositorio.js';
import {
  type AcessoCompras,
  assumirPedido,
  criarPedido,
  editarPedido,
  historicoDoPedido,
  listarInsumos,
  listarPedidos,
  mudarStatusPedido,
  obterPedido,
} from '../compras/servico.js';
import type { Banco } from '../db/cliente.js';
import { ErroApi, lerCorpo } from '../erros.js';
import { usuarioDe } from '../plugins/autenticacao.js';

const pedidoNaoEncontrado = () =>
  new ErroApi(404, 'pedido_nao_encontrado', 'Pedido de compra não encontrado.');

// Pedidos de compra de insumos (ADR 0012), só nas empresas com sincronização do Bling (nas outras, 404). Ver e
// acompanhar o próprio pedido é do módulo (`compras`); criar, de `compras.pedir`; assumir e mudar o status de
// qualquer pedido, de `compras.acompanhar`. Pedido fora do alcance responde 404.
export function rotasCompras(app: FastifyInstance, { db }: { db: Banco }): void {
  const { exigirUsuario, exigirEmpresa, exigirPermissao } = app.autenticacao;

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

  app.get(`${base}/insumos`, { preHandler: pedir }, async (request): Promise<Insumo[]> =>
    listarInsumos(db, await empresaDe(request)),
  );

  app.post(
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

  app.get(`${base}/pedidos`, { preHandler: modulo }, async (request): Promise<PedidoCompra[]> => {
    const consulta = lerCorpo(EsquemaConsultaCompras, request.query);
    return listarPedidos(db, await empresaDe(request), acessoDe(request), consulta);
  });

  app.get(`${base}/pedidos/:id`, { preHandler: modulo }, async (request): Promise<PedidoCompra> => {
    const empresaId = await empresaDe(request);
    const pedido = await obterPedido(db, empresaId, pedidoIdDe(request), acessoDe(request));
    if (!pedido) throw pedidoNaoEncontrado();
    return pedido;
  });

  app.patch(
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

  app.post(
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
  app.patch(
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

  app.get(
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
}
