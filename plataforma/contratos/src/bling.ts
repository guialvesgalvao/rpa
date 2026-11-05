import { z } from 'zod';

import type { Perfil } from './auth.ts';

// Empresas que podem ler produtos e clientes do Bling pela API v3. A API e o app consultam esta lista.
export const EMPRESAS_SINCRONIZACAO_BLING = ['roma'] as const;

/** A sincronização é só do admin das empresas da lista (slug com comparação exata). */
export function podeSincronizarBling(perfil: Perfil, empresaSlug: string | undefined): boolean {
  return (
    perfil === 'admin' &&
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

export type EmpresaSincronizacaoBling = (typeof EMPRESAS_SINCRONIZACAO_BLING)[number];
export type ConexaoBling = z.infer<typeof EsquemaConexaoBling>;
export type EtapaSincronizacaoBling = z.infer<typeof EsquemaEtapaSincronizacaoBling>;
export type ResumoSincronizacaoBling = z.infer<typeof EsquemaResumoSincronizacaoBling>;
export type EstadoSincronizacaoBling = z.infer<typeof EsquemaEstadoSincronizacaoBling>;
