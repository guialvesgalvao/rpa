import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

export const PERFIS = ['admin', 'arte_finalista'] as const;
export type Perfil = (typeof PERFIS)[number];

export const ORIGENS_SESSAO = ['web', 'desktop'] as const;
export type OrigemSessao = (typeof ORIGENS_SESSAO)[number];

const instante = (nome: string) => timestamp(nome, { withTimezone: true });

export const empresas = pgTable('empresas', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: text('slug').notNull().unique(),
  nome: text('nome').notNull(),
});

export const usuarios = pgTable(
  'usuarios',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email').notNull().unique(),
    nome: text('nome').notNull(),
    senhaHash: text('senha_hash').notNull(),
    perfil: text('perfil').$type<Perfil>().notNull(),
    ativo: boolean('ativo').notNull().default(true),
    criadoEm: instante('criado_em').notNull().defaultNow(),
    atualizadoEm: instante('atualizado_em').notNull().defaultNow(),
  },
  (t) => [
    check('usuarios_email_minusculo', sql`${t.email} = lower(${t.email})`),
    check('usuarios_perfil_valido', sql`${t.perfil} in ('admin', 'arte_finalista')`),
  ],
);

export const usuarioEmpresas = pgTable(
  'usuario_empresas',
  {
    usuarioId: uuid('usuario_id')
      .notNull()
      .references(() => usuarios.id, { onDelete: 'cascade' }),
    empresaId: uuid('empresa_id')
      .notNull()
      .references(() => empresas.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.usuarioId, t.empresaId] })],
);

// Os hashes são o SHA-256 (hex) do token de renovação; o token em si nunca é gravado.
// `hash_anterior` serve para distinguir corrida de roubo depois de uma rotação.
export const sessoes = pgTable(
  'sessoes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    usuarioId: uuid('usuario_id')
      .notNull()
      .references(() => usuarios.id, { onDelete: 'cascade' }),
    origem: text('origem').$type<OrigemSessao>().notNull(),
    hashAtual: text('hash_atual').notNull().unique(),
    hashAnterior: text('hash_anterior'),
    rotacionadaEm: instante('rotacionada_em'),
    expiraEm: instante('expira_em'),
    revogadaEm: instante('revogada_em'),
    motivoRevogacao: text('motivo_revogacao'),
    criadaEm: instante('criada_em').notNull().defaultNow(),
    ultimoUsoEm: instante('ultimo_uso_em').notNull().defaultNow(),
  },
  (t) => [
    check('sessoes_origem_valida', sql`${t.origem} in ('web', 'desktop')`),
    // Web expira (desliza a cada renovação); desktop só termina por logout ou revogação.
    check(
      'sessoes_expiracao_por_origem',
      sql`(${t.origem} = 'web' and ${t.expiraEm} is not null) or (${t.origem} = 'desktop' and ${t.expiraEm} is null)`,
    ),
    index('sessoes_usuario_idx').on(t.usuarioId),
    index('sessoes_hash_anterior_idx').on(t.hashAnterior),
  ],
);
