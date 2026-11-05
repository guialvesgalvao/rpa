import {
  EsquemaResultadoSincronizacaoBling,
  type ResultadoSincronizacaoBling,
} from '@plataforma/contratos';
import { and, eq, isNull, lt, or } from 'drizzle-orm';

import type { Banco } from '../db/cliente.js';
import { blingSincronizacoes } from '../db/esquema.js';

export type EstadoSalvoSincronizacao = {
  // Início da janela do próximo incremental (o início do último ciclo bem-sucedido).
  incrementalDesde: Date | null;
  ultimaCompletaEm: Date | null;
  emExecucaoDesde: Date | null;
  ultimoResultado: ResultadoSincronizacaoBling | null;
};

export type EstadoSincronizacao = {
  ler(empresaId: string): Promise<EstadoSalvoSincronizacao>;
  // Sucesso avança a janela (e, na completa, `ultima_completa_em`); falha ou `nao_conectado` só grava o resultado.
  registrar(empresaId: string, resultado: ResultadoSincronizacaoBling): Promise<void>;
  // Lease do agendador: `true` se pegou (livre, ou o anterior passou da validade).
  tomarLease(empresaId: string, validadeMs: number): Promise<boolean>;
  liberarLease(empresaId: string): Promise<void>;
};

const VAZIO: EstadoSalvoSincronizacao = {
  incrementalDesde: null,
  ultimaCompletaEm: null,
  emExecucaoDesde: null,
  ultimoResultado: null,
};

// Estado por empresa em `bling_sincronizacoes`: sobrevive a um deploy.
export function criarEstadoSincronizacao({
  db,
  relogio = () => new Date(),
}: {
  db: Banco;
  relogio?: () => Date;
}): EstadoSincronizacao {
  const garantirLinha = (empresaId: string) =>
    db.insert(blingSincronizacoes).values({ empresaId }).onConflictDoNothing();

  return {
    async ler(empresaId) {
      const [linha] = await db
        .select()
        .from(blingSincronizacoes)
        .where(eq(blingSincronizacoes.empresaId, empresaId));
      if (!linha) return VAZIO;
      // Um JSON fora do contrato (versão antiga, edição manual) conta como sem resultado.
      const resultado = EsquemaResultadoSincronizacaoBling.safeParse(linha.ultimoResultado);
      return {
        incrementalDesde: linha.incrementalDesde,
        ultimaCompletaEm: linha.ultimaCompletaEm,
        emExecucaoDesde: linha.emExecucaoDesde,
        ultimoResultado: resultado.success ? resultado.data : null,
      };
    },

    async registrar(empresaId, resultado) {
      const iniciadaEm = new Date(resultado.iniciadaEm);
      const sucesso = resultado.situacao === 'concluida';
      const campos = {
        ultimoResultado: resultado,
        atualizadoEm: relogio(),
        ...(sucesso && { incrementalDesde: iniciadaEm }),
        ...(sucesso && resultado.tipo === 'completa' && { ultimaCompletaEm: iniciadaEm }),
      };
      await db
        .insert(blingSincronizacoes)
        .values({ empresaId, ...campos })
        .onConflictDoUpdate({ target: blingSincronizacoes.empresaId, set: campos });
    },

    async tomarLease(empresaId, validadeMs) {
      await garantirLinha(empresaId);
      const agora = relogio();
      const tomadas = await db
        .update(blingSincronizacoes)
        .set({ emExecucaoDesde: agora })
        .where(
          and(
            eq(blingSincronizacoes.empresaId, empresaId),
            or(
              isNull(blingSincronizacoes.emExecucaoDesde),
              lt(blingSincronizacoes.emExecucaoDesde, new Date(agora.getTime() - validadeMs)),
            ),
          ),
        )
        .returning({ empresaId: blingSincronizacoes.empresaId });
      return tomadas.length > 0;
    },

    async liberarLease(empresaId) {
      await db
        .update(blingSincronizacoes)
        .set({ emExecucaoDesde: null })
        .where(eq(blingSincronizacoes.empresaId, empresaId));
    },
  };
}
