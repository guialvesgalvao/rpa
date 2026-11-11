import type { Opcao, ResponsavelAutomatico } from '@plataforma/contratos';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';

import type { Banco } from '../db/cliente.js';
import { tarefasConfig, usuarioEmpresas, usuarios } from '../db/esquema.js';
import { ErroApi } from '../erros.js';

// Quem pode receber as tarefas automáticas: usuários ativos que, nesta empresa, podem adicionar artes e não
// acompanham as tarefas de todos (quem acompanha distribui o trabalho; não o recebe sozinho). É quem tinha o
// perfil de arte finalista antes das permissões (ADR 0011).
export function elegiveis(db: Banco, empresaId: string): Promise<Opcao[]> {
  return db
    .select({ id: usuarios.id, nome: usuarios.nome })
    .from(usuarios)
    .innerJoin(usuarioEmpresas, eq(usuarioEmpresas.usuarioId, usuarios.id))
    .where(
      and(
        eq(usuarioEmpresas.empresaId, empresaId),
        sql`${usuarioEmpresas.permissoes} @> array['artes', 'artes.adicionar']::text[]`,
        sql`not (${usuarioEmpresas.permissoes} @> array['artes.acompanhar']::text[])`,
        eq(usuarios.ativo, true),
        isNull(usuarios.excluidoEm),
      ),
    )
    .orderBy(asc(usuarios.nome), asc(usuarios.id));
}

async function configurado(db: Banco, empresaId: string): Promise<string | null> {
  const [linha] = await db
    .select({ id: tarefasConfig.responsavelAutomaticoId })
    .from(tarefasConfig)
    .where(eq(tarefasConfig.empresaId, empresaId));
  return linha?.id ?? null;
}

// Quem recebe a tarefa automática: o configurado, se ainda for elegível (ativo, arte finalista e da
// empresa); senão, a única arte finalista ativa da empresa; senão, ninguém (`null`).
export async function resolverResponsavelAutomatico(
  db: Banco,
  empresaId: string,
): Promise<string | null> {
  const [lista, escolhido] = await Promise.all([
    elegiveis(db, empresaId),
    configurado(db, empresaId),
  ]);
  if (escolhido && lista.some((u) => u.id === escolhido)) return escolhido;
  return lista.length === 1 ? lista[0]!.id : null;
}

export async function obterResponsavelAutomatico(
  db: Banco,
  empresaId: string,
): Promise<ResponsavelAutomatico> {
  const [lista, escolhido] = await Promise.all([
    elegiveis(db, empresaId),
    configurado(db, empresaId),
  ]);
  return { responsavelId: escolhido, elegiveis: lista };
}

// `null` limpa a escolha (volta à regra da única arte finalista). Inelegível: 400.
export async function definirResponsavelAutomatico(
  db: Banco,
  empresaId: string,
  responsavelId: string | null,
): Promise<ResponsavelAutomatico> {
  if (responsavelId) {
    const lista = await elegiveis(db, empresaId);
    if (!lista.some((u) => u.id === responsavelId)) {
      throw new ErroApi(
        400,
        'responsavel_invalido',
        'Escolha uma arte finalista ativa desta empresa.',
      );
    }
  }
  await db
    .insert(tarefasConfig)
    .values({ empresaId, responsavelAutomaticoId: responsavelId })
    .onConflictDoUpdate({
      target: tarefasConfig.empresaId,
      set: { responsavelAutomaticoId: responsavelId },
    });
  return obterResponsavelAutomatico(db, empresaId);
}
