import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  char,
  check,
  customType,
  foreignKey,
  index,
  integer,
  jsonb,
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

// Id do registro no Bling (passa de 2³¹, então `bigint`; em JS ainda cabe com folga num `number` seguro).
const idBling = () => bigint('id_bling', { mode: 'number' });

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
    // Criado pela tela com a senha inicial do admin: a tela pede a troca no login (a API não bloqueia).
    deveTrocarSenha: boolean('deve_trocar_senha').notNull().default(false),
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
    // Preenchido pela sincronização com o Bling; nulo nos cadastros manuais ainda não vinculados.
    idBling: idBling(),
    // Inativo ou excluído no Bling: some da busca, mas a linha e as artes ficam.
    inativoNoBlingEm: instante('inativo_no_bling_em'),
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
    unique('clientes_empresa_id_bling_unico').on(t.empresaId, t.idBling),
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
    // Código (SKU) do produto no Bling, para casar o item do pedido; nulo enquanto não informado.
    codigo: text('codigo'),
    idBling: idBling(),
    inativoNoBlingEm: instante('inativo_no_bling_em'),
    criadoEm: instante('criado_em').notNull().defaultNow(),
  },
  (t) => [
    check('produtos_nome_preenchido', sql`btrim(${t.nome}) <> ''`),
    check('produtos_codigo_preenchido', sql`${t.codigo} is null or btrim(${t.codigo}) <> ''`),
    unique('produtos_id_empresa_unico').on(t.id, t.empresaId),
    // Vários produtos sem código são permitidos (nulos não colidem no Postgres).
    unique('produtos_empresa_codigo_unico').on(t.empresaId, t.codigo),
    unique('produtos_empresa_id_bling_unico').on(t.empresaId, t.idBling),
  ],
);

// Último número de OP reservado por empresa; a linha nasce na primeira reserva.
export const opContadores = pgTable(
  'op_contadores',
  {
    empresaId: uuid('empresa_id')
      .primaryKey()
      .references(() => empresas.id),
    ultimo: integer('ultimo').notNull().default(0),
  },
  (t) => [check('op_contadores_ultimo_nao_negativo', sql`${t.ultimo} >= 0`)],
);

// Conexão OAuth da empresa com a API v3 do Bling. Os tokens só entram cifrados (`src/bling/cifra.ts`).
export const blingConexoes = pgTable('bling_conexoes', {
  empresaId: uuid('empresa_id')
    .primaryKey()
    .references(() => empresas.id, { onDelete: 'cascade' }),
  accessTokenCifrado: text('access_token_cifrado').notNull(),
  accessExpiraEm: instante('access_expira_em').notNull(),
  refreshTokenCifrado: text('refresh_token_cifrado').notNull(),
  autorizadoPor: uuid('autorizado_por').references(() => usuarios.id, { onDelete: 'set null' }),
  autorizadoEm: instante('autorizado_em').notNull(),
  atualizadoEm: instante('atualizado_em').notNull(),
});

// Estado da sincronização automática com o Bling, por empresa. Fica no banco para continuar de onde parou depois
// de um deploy. `em_execucao_desde` é o lease do agendador; `ultimo_resultado` segue o contrato
// `EsquemaResultadoSincronizacaoBling`.
export const blingSincronizacoes = pgTable('bling_sincronizacoes', {
  empresaId: uuid('empresa_id')
    .primaryKey()
    .references(() => empresas.id, { onDelete: 'cascade' }),
  incrementalDesde: instante('incremental_desde'),
  ultimaCompletaEm: instante('ultima_completa_em'),
  emExecucaoDesde: instante('em_execucao_desde'),
  ultimoResultado: jsonb('ultimo_resultado').$type<unknown>(),
  atualizadoEm: instante('atualizado_em').notNull().defaultNow(),
});

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

// Tarefas de desenvolvimento de arte (ver `contratos/src/tarefas.ts`). A lista de status se repete nos
// CHECKs abaixo; ao mudar, mude os dois.
const STATUS_TAREFA_SQL = sql.raw(
  `('nao_iniciada', 'em_desenvolvimento', 'aguardando_cliente', 'concluida', 'cancelada')`,
);

export const tarefasArte = pgTable(
  'tarefas_arte',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    empresaId: uuid('empresa_id')
      .notNull()
      .references(() => empresas.id),
    clienteId: uuid('cliente_id').notNull(),
    produtoId: uuid('produto_id').notNull(),
    // Quem criou a tarefa; é quem a vê em "Minhas tarefas".
    responsavelId: uuid('responsavel_id').references(() => usuarios.id, { onDelete: 'set null' }),
    status: text('status').notNull().default('nao_iniciada'),
    // A arte cadastrada na conclusão. Não pode ser removida enquanto a tarefa existir.
    arteId: uuid('arte_id').references(() => artes.id, { onDelete: 'restrict' }),
    criadoEm: instante('criado_em').notNull().defaultNow(),
    atualizadoEm: instante('atualizado_em').notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: 'tarefas_arte_cliente_empresa_fk',
      columns: [t.clienteId, t.empresaId],
      foreignColumns: [clientes.id, clientes.empresaId],
    }),
    foreignKey({
      name: 'tarefas_arte_produto_empresa_fk',
      columns: [t.produtoId, t.empresaId],
      foreignColumns: [produtos.id, produtos.empresaId],
    }),
    check('tarefas_arte_status_valido', sql`${t.status} in ${STATUS_TAREFA_SQL}`),
    // "Para ser concluída, deve ter todos os campos cadastrados": a arte existe.
    check(
      'tarefas_arte_concluida_com_arte',
      sql`${t.status} <> 'concluida' or ${t.arteId} is not null`,
    ),
    index('tarefas_arte_empresa_status_idx').on(t.empresaId, t.status),
    index('tarefas_arte_responsavel_idx').on(t.responsavelId),
  ],
);

export const tarefasArteComentarios = pgTable(
  'tarefas_arte_comentarios',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tarefaId: uuid('tarefa_id')
      .notNull()
      .references(() => tarefasArte.id, { onDelete: 'cascade' }),
    autorId: uuid('autor_id').references(() => usuarios.id, { onDelete: 'set null' }),
    texto: text('texto').notNull(),
    criadoEm: instante('criado_em').notNull().defaultNow(),
  },
  (t) => [
    check(
      'tarefas_arte_comentarios_texto_valido',
      sql`btrim(${t.texto}) <> '' and char_length(${t.texto}) <= 2000`,
    ),
    index('tarefas_arte_comentarios_tarefa_idx').on(t.tarefaId, t.criadoEm),
  ],
);

export const tarefasArteHistorico = pgTable(
  'tarefas_arte_historico',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tarefaId: uuid('tarefa_id')
      .notNull()
      .references(() => tarefasArte.id, { onDelete: 'cascade' }),
    // Nulo na criação da tarefa.
    statusAnterior: text('status_anterior'),
    statusNovo: text('status_novo').notNull(),
    autorId: uuid('autor_id').references(() => usuarios.id, { onDelete: 'set null' }),
    criadoEm: instante('criado_em').notNull().defaultNow(),
  },
  (t) => [
    check(
      'tarefas_arte_historico_status_valido',
      sql`(${t.statusAnterior} is null or ${t.statusAnterior} in ${STATUS_TAREFA_SQL}) and ${t.statusNovo} in ${STATUS_TAREFA_SQL}`,
    ),
    index('tarefas_arte_historico_tarefa_idx').on(t.tarefaId, t.criadoEm),
  ],
);
