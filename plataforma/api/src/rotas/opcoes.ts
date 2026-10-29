import type { Opcao } from '@plataforma/contratos';
import type { FastifyInstance } from 'fastify';

import { listarCores, listarMaquinas } from '../artes/repositorio.js';
import type { Banco } from '../db/cliente.js';

// Cores e máquinas são globais (iguais nas duas empresas): basta estar autenticado.
export function rotasOpcoes(app: FastifyInstance, { db }: { db: Banco }): void {
  const preHandler = app.autenticacao.exigirUsuario;
  app.get('/v1/cores', { preHandler }, async (): Promise<Opcao[]> => listarCores(db));
  app.get('/v1/maquinas', { preHandler }, async (): Promise<Opcao[]> => listarMaquinas(db));
}
