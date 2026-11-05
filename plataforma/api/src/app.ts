import type { Saude } from '@plataforma/contratos';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';

import { criarLimite } from './auth/limite.js';
import { criarTokens } from './auth/tokens.js';
import { criarArmazemPostgres } from './bling/armazem.js';
import { criarCifra } from './bling/cifra.js';
import { criarClienteBling } from './bling/cliente.js';
import { criarConexoesBling } from './bling/conexoes.js';
import { criarEstadoSincronizacao } from './bling/estado.js';
import { criarExecucaoSincronizacao } from './bling/execucao.js';
import { criarOAuthBling } from './bling/oauth.js';
import { sincronizarBling } from './bling/sincronizacao.js';
import type { ConfigBling } from './config.js';
import type { Banco } from './db/cliente.js';
import { configurarErros } from './erros.js';
import { criarAutenticacao } from './plugins/autenticacao.js';
import { rotasArtes } from './rotas/artes.js';
import { rotasAuth } from './rotas/auth.js';
import { rotasBling, type ServicosBling } from './rotas/bling.js';
import { rotasClientes } from './rotas/clientes.js';
import { rotasOp } from './rotas/op.js';
import { rotasOpcoes } from './rotas/opcoes.js';

export type DepsApp = Pick<FastifyServerOptions, 'logger'> & {
  db: Banco;
  jwtSegredo: string;
  // Fonte do "agora" para tokens, sessões e limite de tentativas; os testes injetam um relógio falso.
  relogio?: () => Date;
  // Sincronização com o Bling; ausente, as rotas do Bling respondem 503. `fetch` e `esperar` (intervalo entre
  // chamadas ao Bling) são injetáveis nos testes.
  bling?: ConfigBling & { fetch?: typeof fetch; esperar?: (ms: number) => Promise<void> };
};

export function criarApp({
  db,
  jwtSegredo,
  relogio = () => new Date(),
  logger,
  bling,
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
  rotasClientes(app, { db });
  rotasOpcoes(app, { db });
  rotasArtes(app, { db });
  rotasOp(app, { db });
  const servicosBling = bling && criarServicosBling(app, { db, jwtSegredo, relogio, bling });
  rotasBling(app, { db, bling: servicosBling });
  if (servicosBling) app.addHook('onClose', () => servicosBling.execucao.encerrar());

  return app;
}

function criarServicosBling(
  app: FastifyInstance,
  {
    db,
    jwtSegredo,
    relogio,
    bling,
  }: Pick<DepsApp, 'db' | 'jwtSegredo'> & {
    relogio: () => Date;
    bling: NonNullable<DepsApp['bling']>;
  },
): ServicosBling {
  // O ritmo de chamadas usa o relógio real; o vencimento dos tokens, o relógio da API.
  const cliente = criarClienteBling({
    ...(bling.fetch && { fetch: bling.fetch }),
    ...(bling.esperar && { esperar: bling.esperar }),
  });
  const conexoes = criarConexoesBling({ db, cifra: criarCifra(bling.chaveTokens), relogio });
  const oauth = criarOAuthBling({ config: bling, cliente, conexoes, jwtSegredo, relogio });
  const estado = criarEstadoSincronizacao({ db, relogio });
  const execucao = criarExecucaoSincronizacao({
    sincronizar: (opcoes) => sincronizarBling(cliente, opcoes),
    armazem: criarArmazemPostgres({ db, relogio }),
    relogio,
    // Só o nome do erro: nada de tokens nem dados do Bling no log.
    aoFalhar: (erro) =>
      app.log.error(
        { erro: erro instanceof Error ? erro.name : 'desconhecido' },
        'Falha na sincronização do Bling',
      ),
    aoConcluir: (empresa, resultado) => estado.registrar(empresa.id, resultado),
  });
  return { oauth, execucao, estado, automatica: bling.automatica };
}
