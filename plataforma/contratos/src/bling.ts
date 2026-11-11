import { z } from 'zod';

import { temPermissao } from './permissoes.ts';

// Empresas que podem ler produtos e clientes do Bling pela API v3. A API e o app consultam esta lista.
export const EMPRESAS_SINCRONIZACAO_BLING = ['roma'] as const;

/** A sincronização é de quem tem OP's (`ops`) nas empresas da lista (slug com comparação exata). */
export function podeSincronizarBling(
  permissoes: readonly string[] | undefined,
  empresaSlug: string | undefined,
): boolean {
  return (
    temPermissao(permissoes, 'ops') &&
    empresaSlug !== undefined &&
    (EMPRESAS_SINCRONIZACAO_BLING as readonly string[]).includes(empresaSlug)
  );
}

// Resposta de `POST /v1/empresas/:empresa/bling/conexao`: o link que o usuário abre no navegador.
export const EsquemaConexaoBling = z.object({ urlAutorizacao: z.url() });

export const EsquemaEtapaSincronizacaoBling = z.enum(['produtos', 'clientes', 'detalhes']);

// Só contagens: os dados lidos ficam no servidor.
export const EsquemaResumoSincronizacaoBling = z.object({
  empresa: z.string(),
  iniciadaEm: z.iso.datetime(),
  concluidaEm: z.iso.datetime(),
  produtos: z.number().int().min(0),
  clientes: z.number().int().min(0),
  avisos: z.array(z.string()),
});

// Estado do job por empresa. `total` é `null` enquanto a etapa ainda não sabe quantos itens tem.
export const EsquemaEstadoSincronizacaoBling = z.discriminatedUnion('situacao', [
  z.object({ situacao: z.literal('ociosa') }),
  z.object({
    situacao: z.literal('em_andamento'),
    iniciadaEm: z.iso.datetime(),
    etapa: EsquemaEtapaSincronizacaoBling,
    lidos: z.number().int().min(0),
    total: z.number().int().min(0).nullable(),
  }),
  z.object({ situacao: z.literal('concluida'), resumo: EsquemaResumoSincronizacaoBling }),
  z.object({
    situacao: z.literal('falhou'),
    iniciadaEm: z.iso.datetime(),
    concluidaEm: z.iso.datetime(),
    erro: z.object({ codigo: z.string(), mensagem: z.string() }),
  }),
]);

// Resultado de um ciclo (do botão ou do agendador), gravado no banco. Só contagens, nunca dados do Bling.
// `nao_conectado`: a empresa não tem conexão válida com o Bling (o ciclo nem começou, ou a conexão caiu).
export const EsquemaResultadoSincronizacaoBling = z.object({
  tipo: z.enum(['completa', 'incremental']),
  origem: z.enum(['agendador', 'botao']),
  situacao: z.enum(['concluida', 'falhou', 'nao_conectado']),
  iniciadaEm: z.iso.datetime(),
  concluidaEm: z.iso.datetime(),
  produtos: z.number().int().min(0),
  clientes: z.number().int().min(0),
  avisos: z.array(z.string()),
  erro: z.object({ codigo: z.string(), mensagem: z.string() }).optional(),
});

// Conta do Bling conectada à empresa. `cnpj` só com dígitos.
export const EsquemaContaBling = z.object({ nome: z.string(), cnpj: z.string() });

// Resposta de `GET /v1/empresas/:empresa/bling/sincronizacao/automatica`. `proximaCompletaEm` é `null` com a
// automática desligada ou antes da primeira completa. `conta` é `null` sem conexão ou com uma conexão anterior à
// verificação da conta.
export const EsquemaSincronizacaoAutomaticaBling = z.object({
  ligada: z.boolean(),
  intervaloMinutos: z.number().int().min(1),
  completaDias: z.number().int().min(1),
  ultima: EsquemaResultadoSincronizacaoBling.nullable(),
  ultimaCompletaEm: z.iso.datetime().nullable(),
  proximaCompletaEm: z.iso.datetime().nullable(),
  conta: EsquemaContaBling.nullable(),
});

export type EmpresaSincronizacaoBling = (typeof EMPRESAS_SINCRONIZACAO_BLING)[number];
export type ConexaoBling = z.infer<typeof EsquemaConexaoBling>;
export type ContaBling = z.infer<typeof EsquemaContaBling>;
export type EtapaSincronizacaoBling = z.infer<typeof EsquemaEtapaSincronizacaoBling>;
export type ResumoSincronizacaoBling = z.infer<typeof EsquemaResumoSincronizacaoBling>;
export type EstadoSincronizacaoBling = z.infer<typeof EsquemaEstadoSincronizacaoBling>;
export type ResultadoSincronizacaoBling = z.infer<typeof EsquemaResultadoSincronizacaoBling>;
export type SincronizacaoAutomaticaBling = z.infer<typeof EsquemaSincronizacaoAutomaticaBling>;
