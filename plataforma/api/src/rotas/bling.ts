import {
  type ConexaoBling,
  EMPRESAS_SINCRONIZACAO_BLING,
  type EstadoSincronizacaoBling,
  type SincronizacaoAutomaticaBling,
} from '@plataforma/contratos';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { idDaEmpresa } from '../artes/repositorio.js';
import { usuarioDe } from '../plugins/autenticacao.js';
import { ErroBling, ErroBlingConcessaoInvalida, ErroBlingNaoAutorizado } from '../bling/cliente.js';
import type { ConexoesBling } from '../bling/conexoes.js';
import type { EstadoSincronizacao } from '../bling/estado.js';
import type { ExecucaoSincronizacao } from '../bling/execucao.js';
import {
  ErroBlingContaErrada,
  ErroBlingNaoConectado,
  ErroBlingSemEscopoEmpresa,
  ErroBlingStateInvalido,
  type OAuthBling,
} from '../bling/oauth.js';
import type { ConfigSincronizacaoAutomatica } from '../config.js';
import type { Banco } from '../db/cliente.js';
import { ErroApi } from '../erros.js';

export type ServicosBling = {
  oauth: OAuthBling;
  conexoes: Pick<ConexoesBling, 'conta'>;
  execucao: ExecucaoSincronizacao;
  estado: EstadoSincronizacao;
  automatica: ConfigSincronizacaoAutomatica;
};

const DIA_MS = 24 * 60 * 60 * 1000;

const MENSAGEM_NAO_CONECTADO =
  'A empresa não está conectada ao Bling. Autorize o acesso e tente de novo.';

// Erros do Bling viram respostas do contrato, sem detalhes do Bling.
function erroApiDoBling(erro: unknown): unknown {
  if (erro instanceof ErroBlingNaoConectado || erro instanceof ErroBlingNaoAutorizado)
    return new ErroApi(409, 'bling_nao_conectado', MENSAGEM_NAO_CONECTADO);
  if (erro instanceof ErroBling)
    return new ErroApi(
      502,
      'bling_indisponivel',
      'O Bling não respondeu. Tente de novo em alguns minutos.',
    );
  return erro;
}

const EsquemaRetorno = z.object({
  code: z.string().min(1).max(2048),
  state: z.string().min(1).max(4096),
});

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};
const escapar = (texto: string) => texto.replace(/[&<>"']/g, (c) => ESCAPES[c] ?? c);

// Página curta para o navegador, sem detalhes internos. `titulo` e `texto` são escapados aqui.
function pagina(reply: FastifyReply, status: number, titulo: string, texto: string) {
  return reply
    .code(status)
    .header('content-type', 'text/html; charset=utf-8')
    .header('content-security-policy', "default-src 'none'")
    .header('referrer-policy', 'no-referrer')
    .header('cache-control', 'no-store')
    .send(
      `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${escapar(titulo)}</title>` +
        `</head><body><h1>${escapar(titulo)}</h1><p>${escapar(texto)}</p></body></html>`,
    );
}

export function rotasBling(
  app: FastifyInstance,
  { db, bling }: { db: Banco; bling: ServicosBling | undefined },
): void {
  const exigirSincronizacao = async (request: FastifyRequest) => {
    const { empresa } = request.params as { empresa: string };
    if (!(EMPRESAS_SINCRONIZACAO_BLING as readonly string[]).includes(empresa))
      throw new ErroApi(
        403,
        'sincronizacao_indisponivel',
        'Sincronização com o Bling indisponível para esta empresa.',
      );
  };
  const preHandler = [
    app.autenticacao.exigirUsuario,
    app.autenticacao.exigirEmpresa('empresa'),
    app.autenticacao.exigirPermissao('ops'),
    exigirSincronizacao,
  ];

  function servicos(): ServicosBling {
    if (!bling)
      throw new ErroApi(
        503,
        'bling_nao_configurado',
        'Sincronização com o Bling não configurada no servidor.',
      );
    return bling;
  }

  async function empresaDe(request: FastifyRequest): Promise<{ slug: string; id: string }> {
    const { empresa } = request.params as { empresa: string };
    // Empresa do token que não existe no banco: tratada como inexistente.
    const id = await idDaEmpresa(db, empresa);
    if (!id) throw new ErroApi(404, 'empresa_nao_encontrada', 'Empresa não encontrada.');
    return { slug: empresa, id };
  }

  app.post(
    '/v1/empresas/:empresa/bling/conexao',
    { preHandler },
    async (request): Promise<ConexaoBling> => {
      const { oauth } = servicos();
      const empresa = await empresaDe(request);
      return {
        urlAutorizacao: await oauth.urlAutorizacao(empresa.id, usuarioDe(request).usuarioId),
      };
    },
  );

  app.post(
    '/v1/empresas/:empresa/bling/sincronizacao',
    { preHandler },
    async (request, reply): Promise<EstadoSincronizacaoBling> => {
      const { oauth, execucao } = servicos();
      const empresa = await empresaDe(request);
      // Job já rodando: devolve o estado dele, sem nova checagem nem nova leitura.
      const atual = execucao.estado(empresa.slug);
      if (atual.situacao === 'em_andamento') return reply.code(202).send(atual);
      // Checagem síncrona da conexão: o app recebe o 409 e abre a autorização.
      try {
        await oauth.acessoValido(empresa.id);
      } catch (erro) {
        throw erroApiDoBling(erro);
      }
      // O botão sempre faz a completa (corrige exclusões e inativações).
      const estado = execucao.iniciar(
        empresa,
        () => oauth.acessoValido(empresa.id),
        { tipo: 'completa' },
        'botao',
      );
      return reply.code(202).send(estado);
    },
  );

  app.get(
    '/v1/empresas/:empresa/bling/sincronizacao',
    { preHandler },
    async (request): Promise<EstadoSincronizacaoBling> => {
      const { execucao } = servicos();
      const empresa = await empresaDe(request);
      return execucao.estado(empresa.slug);
    },
  );

  // Status da sincronização automática, lido do banco; não chama o Bling.
  app.get(
    '/v1/empresas/:empresa/bling/sincronizacao/automatica',
    { preHandler },
    async (request): Promise<SincronizacaoAutomaticaBling> => {
      const { estado, automatica, conexoes } = servicos();
      const empresa = await empresaDe(request);
      const salvo = await estado.ler(empresa.id);
      const conta = await conexoes.conta(empresa.id);
      const ultimaCompletaEm = salvo.ultimaCompletaEm;
      return {
        ligada: automatica.ligada,
        intervaloMinutos: automatica.intervaloMinutos,
        completaDias: automatica.completaDias,
        ultima: salvo.ultimoResultado,
        ultimaCompletaEm: ultimaCompletaEm?.toISOString() ?? null,
        // Sem o agendador ligado, não há próxima completa automática.
        proximaCompletaEm:
          automatica.ligada && ultimaCompletaEm
            ? new Date(ultimaCompletaEm.getTime() + automatica.completaDias * DIA_MS).toISOString()
            : null,
        conta,
      };
    },
  );

  // Pública (o Bling redireciona o navegador para cá). Log desligado: a URL leva o `code`.
  app.get('/v1/bling/oauth/retorno', { logLevel: 'silent' }, async (request, reply) => {
    if (!bling)
      return pagina(
        reply,
        503,
        'Bling não configurado',
        'A sincronização com o Bling não está configurada no servidor.',
      );
    const lido = EsquemaRetorno.safeParse(request.query);
    if (!lido.success)
      return pagina(
        reply,
        400,
        'Autorização não concluída',
        'O Bling não enviou a autorização. Tente de novo pelo app.',
      );
    try {
      const { conta } = await bling.oauth.concluir(lido.data.code, lido.data.state);
      return pagina(
        reply,
        200,
        conta.nome ? `Bling conectado: ${conta.nome}` : 'Bling conectado',
        'Volte ao app e clique em Sincronizar dados.',
      );
    } catch (erro) {
      if (erro instanceof ErroBlingContaErrada)
        return pagina(
          reply,
          409,
          'Conta do Bling errada',
          `Esta conta do Bling não é a da ${erro.empresaNome}. Saia do Bling, entre com a conta certa ` +
            '(de preferência numa janela anônima) e clique em Sincronizar dados de novo.',
        );
      if (erro instanceof ErroBlingSemEscopoEmpresa)
        return pagina(
          reply,
          403,
          'Falta permissão no aplicativo do Bling',
          'O aplicativo do Bling não tem o escopo de dados da empresa, que confirma qual conta foi ' +
            'autorizada. Peça ao administrador do Bling para incluir esse escopo no aplicativo e clique ' +
            'em Sincronizar dados de novo.',
        );
      if (erro instanceof ErroBlingStateInvalido || erro instanceof ErroBlingConcessaoInvalida)
        return pagina(
          reply,
          400,
          'Autorização inválida ou vencida',
          'Volte ao app e clique em Sincronizar dados para tentar de novo.',
        );
      // Só o nome do erro: mensagens de banco podem trazer os parâmetros da consulta.
      if (!(erro instanceof ErroBling))
        app.log.error(
          { erro: erro instanceof Error ? erro.name : 'desconhecido' },
          'Falha no retorno OAuth do Bling',
        );
      return pagina(
        reply,
        502,
        'Não foi possível conectar ao Bling',
        'Tente de novo em alguns minutos pelo app.',
      );
    }
  });
}
