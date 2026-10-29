import type { Saude } from '@plataforma/contratos';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';

import { criarLimite } from './auth/limite.js';
import { criarTokens } from './auth/tokens.js';
import type { Banco } from './db/cliente.js';
import { configurarErros } from './erros.js';
import { criarAutenticacao } from './plugins/autenticacao.js';
import { rotasAuth } from './rotas/auth.js';

export type DepsApp = Pick<FastifyServerOptions, 'logger'> & {
  db: Banco;
  jwtSegredo: string;
  // Fonte do "agora" para tokens, sessões e limite de tentativas; os testes injetam um relógio falso.
  relogio?: () => Date;
};

export function criarApp({
  db,
  jwtSegredo,
  relogio = () => new Date(),
  logger,
}: DepsApp): FastifyInstance {
  if (Buffer.byteLength(jwtSegredo) < 32)
    throw new Error('O segredo do JWT precisa de ao menos 32 bytes.');

  const app = Fastify({ logger: logger ?? false });
  configurarErros(app);

  const tokens = criarTokens(jwtSegredo);
  app.decorateRequest('usuario', null);
  app.decorate('autenticacao', criarAutenticacao({ db, tokens, relogio }));

  app.get('/v1/saude', async (): Promise<Saude> => ({ status: 'ok' }));
  rotasAuth(app, { db, tokens, relogio, limite: criarLimite(relogio) });

  return app;
}
