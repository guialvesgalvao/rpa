import { sql } from 'drizzle-orm';
import {
  boolean,
  char,
  check,
  customType,
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
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

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => 'bytea',
});

// Clientes e produtos são inseridos à mão no banco: as regras de formato ficam aqui (CHECK, colunas geradas e
// índices), não só na API. As funções `f_unaccent` e `cnpj_valido` vêm da migração `artes_funcoes`.
// Os índices de expressão (busca, ordenação e unicidade sem acento) estão na migração `artes_indices`.
export const clientes = pgTable(
  'clientes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    empresaId: uuid('empresa_id')
      .notNull()
      .references(() => empresas.id),
    razaoSocial: text('razao_social').notNull(),
    nomeFantasia: text('nome_fantasia'),
    // 14 dígitos, sem pontuação.
    cnpj: char('cnpj', { length: 14 }).notNull(),
    nomeExibicao: text('nome_exibicao').generatedAlwaysAs(
      sql`coalesce(nome_fantasia, razao_social)`,
    ),
    busca: text('busca').generatedAlwaysAs(
      sql`f_unaccent(lower(razao_social || ' ' || coalesce(nome_fantasia, '') || ' ' || cnpj))`,
    ),
    criadoEm: instante('criado_em').notNull().defaultNow(),
  },
  (t) => [
    check('clientes_cnpj_valido', sql`${t.cnpj} ~ '^[0-9]{14}$' and cnpj_valido(${t.cnpj})`),
    check('clientes_razao_social_preenchida', sql`btrim(${t.razaoSocial}) <> ''`),
    check(
      'clientes_nome_fantasia_preenchido',
      sql`${t.nomeFantasia} is null or btrim(${t.nomeFantasia}) <> ''`,
    ),
    unique('clientes_empresa_cnpj_unico').on(t.empresaId, t.cnpj),
    // Alvo das chaves estrangeiras compostas de `artes`.
    unique('clientes_id_empresa_unico').on(t.id, t.empresaId),
  ],
);

export const produtos = pgTable(
  'produtos',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    empresaId: uuid('empresa_id')
      .notNull()
      .references(() => empresas.id),
    nome: text('nome').notNull(),
    criadoEm: instante('criado_em').notNull().defaultNow(),
  },
  (t) => [
    check('produtos_nome_preenchido', sql`btrim(${t.nome}) <> ''`),
    unique('produtos_id_empresa_unico').on(t.id, t.empresaId),
  ],
);

// Globais: iguais para as duas empresas (valores de referência na migração `artes_cores_maquinas`).
export const cores = pgTable('cores', {
  id: uuid('id').primaryKey().defaultRandom(),
  nome: text('nome').notNull().unique(),
});

export const maquinas = pgTable('maquinas', {
  id: uuid('id').primaryKey().defaultRandom(),
  nome: text('nome').notNull().unique(),
});

// O conteúdo fica no Postgres (decisão do plano; gatilho de revisão: ~20 GB). Tabela separada para que as
// consultas de `artes` nunca carreguem os bytes.
export const arquivos = pgTable(
  'arquivos',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    nomeOriginal: text('nome_original').notNull(),
    tipoMime: text('tipo_mime').notNull(),
    tamanho: integer('tamanho').notNull(),
    sha256: char('sha256', { length: 64 }).notNull(),
    conteudo: bytea('conteudo').notNull(),
    criadoEm: instante('criado_em').notNull().defaultNow(),
  },
  (t) => [
    check(
      'arquivos_tamanho_confere',
      sql`${t.tamanho} > 0 and ${t.tamanho} = octet_length(${t.conteudo})`,
    ),
    check('arquivos_sha256_hex', sql`${t.sha256} ~ '^[0-9a-f]{64}$'`),
  ],
);

export const artes = pgTable(
  'artes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    empresaId: uuid('empresa_id')
      .notNull()
      .references(() => empresas.id),
    clienteId: uuid('cliente_id').notNull(),
    produtoId: uuid('produto_id').notNull(),
    nome: text('nome').notNull().default('Padrão'),
    corId: uuid('cor_id')
      .notNull()
      .references(() => cores.id),
    pdfId: uuid('pdf_id')
      .references(() => arquivos.id)
      .unique(),
    imagemId: uuid('imagem_id')
      .references(() => arquivos.id)
      .unique(),
    criadoPor: uuid('criado_por').references(() => usuarios.id, { onDelete: 'set null' }),
    criadoEm: instante('criado_em').notNull().defaultNow(),
    atualizadoPor: uuid('atualizado_por').references(() => usuarios.id, { onDelete: 'set null' }),
    atualizadoEm: instante('atualizado_em').notNull().defaultNow(),
  },
  (t) => [
    // O cliente e o produto precisam ser da mesma empresa da arte.
    foreignKey({
      name: 'artes_cliente_empresa_fk',
      columns: [t.clienteId, t.empresaId],
      foreignColumns: [clientes.id, clientes.empresaId],
    }),
    foreignKey({
      name: 'artes_produto_empresa_fk',
      columns: [t.produtoId, t.empresaId],
      foreignColumns: [produtos.id, produtos.empresaId],
    }),
    check('artes_ao_menos_um_arquivo', sql`${t.pdfId} is not null or ${t.imagemId} is not null`),
    check('artes_nome_preenchido', sql`btrim(${t.nome}) <> ''`),
    index('artes_cliente_produto_idx').on(t.clienteId, t.produtoId),
  ],
);

// Ao menos uma máquina por arte é regra da API (o banco não consegue exigir linhas filhas).
export const arteMaquinas = pgTable(
  'arte_maquinas',
  {
    arteId: uuid('arte_id')
      .notNull()
      .references(() => artes.id, { onDelete: 'cascade' }),
    maquinaId: uuid('maquina_id')
      .notNull()
      .references(() => maquinas.id),
  },
  (t) => [primaryKey({ columns: [t.arteId, t.maquinaId] })],
);
