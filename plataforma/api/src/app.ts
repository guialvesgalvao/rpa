import type { Saude } from '@plataforma/contratos';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';

export type OpcoesApp = Pick<FastifyServerOptions, 'logger'>;

export function criarApp(opcoes: OpcoesApp = {}): FastifyInstance {
  const app = Fastify({ logger: opcoes.logger ?? false });

  app.get('/v1/saude', async (): Promise<Saude> => ({ status: 'ok' }));

  return app;
}
