import type { Erro } from '@plataforma/contratos';
import type { FastifyInstance } from 'fastify';
import type { z } from 'zod';

// Erro com resposta definida: `{ erro: { codigo, mensagem } }` com o status informado.
export class ErroApi extends Error {
  override name = 'ErroApi';

  constructor(
    readonly status: number,
    readonly codigo: string,
    mensagem: string,
  ) {
    super(mensagem);
  }
}

const corpoErro = (codigo: string, mensagem: string): Erro => ({ erro: { codigo, mensagem } });

export function lerCorpo<T>(esquema: z.ZodType<T>, corpo: unknown): T {
  const resultado = esquema.safeParse(corpo);
  if (resultado.success) return resultado.data;
  const campos = [...new Set(resultado.error.issues.map((issue) => issue.path.join('.')))];
  const detalhe = campos.filter(Boolean).join(', ');
  throw new ErroApi(
    400,
    'requisicao_invalida',
    `Requisição inválida${detalhe ? ` (${detalhe})` : ''}.`,
  );
}

// Toda resposta de erro segue o contrato, inclusive as do próprio Fastify (JSON malformado, 404).
export function configurarErros(app: FastifyInstance): void {
  app.setErrorHandler((erro, request, reply) => {
    if (erro instanceof ErroApi) {
      return reply.code(erro.status).send(corpoErro(erro.codigo, erro.message));
    }
    // Erros do Fastify trazem `statusCode` (ex.: 400 para JSON malformado, 415 para outro formato).
    const status = (erro as { statusCode?: unknown } | null)?.statusCode;
    if (typeof status === 'number' && status >= 400 && status < 500) {
      return reply.code(status).send(corpoErro('requisicao_invalida', 'Requisição inválida.'));
    }
    request.log.error(erro);
    return reply.code(500).send(corpoErro('erro_interno', 'Erro interno.'));
  });

  app.setNotFoundHandler((_request, reply) =>
    reply.code(404).send(corpoErro('nao_encontrado', 'Rota não encontrada.')),
  );
}
