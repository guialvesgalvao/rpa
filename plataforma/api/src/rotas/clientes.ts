import {
  type ArteDoProduto,
  type Cliente,
  EsquemaConsultaClientes,
  type Opcao,
  type PaginaClientes,
  type ProdutoDoCliente,
} from '@plataforma/contratos';
import type { FastifyInstance, FastifyRequest } from 'fastify';

import {
  artesDoProduto,
  buscarCliente,
  buscarProduto,
  decodificarCursor,
  ehUuid,
  idDaEmpresa,
  listarClientes,
  listarProdutos,
  produtosDoCliente,
} from '../artes/repositorio.js';
import type { Banco } from '../db/cliente.js';
import { ErroApi, lerCorpo } from '../erros.js';

export function rotasClientes(app: FastifyInstance, { db }: { db: Banco }): void {
  // Clientes, produtos e artes são do módulo Artes.
  const preHandler = [
    app.autenticacao.exigirUsuario,
    app.autenticacao.exigirEmpresa('empresa'),
    app.autenticacao.exigirPermissao('artes'),
  ];

  // Empresa do token que não existe no banco: tratada como inexistente.
  async function empresaDe(request: FastifyRequest): Promise<string> {
    const { empresa } = request.params as { empresa: string };
    const id = await idDaEmpresa(db, empresa);
    if (!id) throw new ErroApi(404, 'empresa_nao_encontrada', 'Empresa não encontrada.');
    return id;
  }

  // Cliente inexistente, de outra empresa ou com id malformado: sempre 404.
  async function clienteDe(request: FastifyRequest, empresaId: string): Promise<Cliente> {
    const { id } = request.params as { id: string };
    const cliente = ehUuid(id) ? await buscarCliente(db, empresaId, id) : null;
    if (!cliente) throw new ErroApi(404, 'cliente_nao_encontrado', 'Cliente não encontrado.');
    return cliente;
  }

  app.get(
    '/v1/empresas/:empresa/clientes',
    { preHandler },
    async (request): Promise<PaginaClientes> => {
      const { busca, cursor, limite } = lerCorpo(EsquemaConsultaClientes, request.query);
      const posicao = cursor ? decodificarCursor(cursor) : null;
      if (cursor && !posicao) {
        throw new ErroApi(400, 'requisicao_invalida', 'Requisição inválida (cursor).');
      }
      return listarClientes(db, await empresaDe(request), { busca, cursor: posicao, limite });
    },
  );

  app.get('/v1/empresas/:empresa/clientes/:id', { preHandler }, async (request): Promise<Cliente> =>
    clienteDe(request, await empresaDe(request)),
  );

  app.get(
    '/v1/empresas/:empresa/clientes/:id/produtos',
    { preHandler },
    async (request): Promise<ProdutoDoCliente[]> => {
      const empresaId = await empresaDe(request);
      const cliente = await clienteDe(request, empresaId);
      return produtosDoCliente(db, empresaId, cliente.id);
    },
  );

  // Produto de outra empresa, inexistente ou com id malformado: sempre 404. Sem artes: lista vazia.
  app.get(
    '/v1/empresas/:empresa/clientes/:id/produtos/:produtoId/artes',
    { preHandler },
    async (request): Promise<ArteDoProduto[]> => {
      const empresaId = await empresaDe(request);
      const cliente = await clienteDe(request, empresaId);
      const { produtoId } = request.params as { produtoId: string };
      const produto = ehUuid(produtoId) ? await buscarProduto(db, empresaId, produtoId) : null;
      if (!produto) throw new ErroApi(404, 'produto_nao_encontrado', 'Produto não encontrado.');
      return artesDoProduto(db, empresaId, cliente.id, produto.id);
    },
  );

  app.get('/v1/empresas/:empresa/produtos', { preHandler }, async (request): Promise<Opcao[]> =>
    listarProdutos(db, await empresaDe(request)),
  );
}
