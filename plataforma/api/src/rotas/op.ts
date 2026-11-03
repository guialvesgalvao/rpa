import { EsquemaReservaNumerosOp, type NumerosOp } from '@plataforma/contratos';
import type { FastifyInstance } from 'fastify';

import { idDaEmpresa } from '../artes/repositorio.js';
import type { Banco } from '../db/cliente.js';
import { ErroApi, lerCorpo } from '../erros.js';
import { reservarNumerosOp } from '../op/servico.js';

export function rotasOp(app: FastifyInstance, { db }: { db: Banco }): void {
  const preHandler = [
    app.autenticacao.exigirUsuario,
    app.autenticacao.exigirEmpresa('empresa'),
    app.autenticacao.exigirPerfil('admin'),
  ];

  app.post(
    '/v1/empresas/:empresa/op/numeros',
    { preHandler },
    async (request, reply): Promise<NumerosOp> => {
      const { quantidade } = lerCorpo(EsquemaReservaNumerosOp, request.body);
      const { empresa } = request.params as { empresa: string };
      // Empresa do token que não existe no banco: tratada como inexistente.
      const empresaId = await idDaEmpresa(db, empresa);
      if (!empresaId) throw new ErroApi(404, 'empresa_nao_encontrada', 'Empresa não encontrada.');
      return reply.code(201).send({ numeros: await reservarNumerosOp(db, empresaId, quantidade) });
    },
  );
}
