-- Cores passam a ser criadas na tela: unicidade sem diferenciar maiúsculas nem acentos ("4X4" = "4x4"),
-- como os índices de expressão da 0004 (o Drizzle não os modela bem).
CREATE UNIQUE INDEX "cores_nome_sem_acento_unico" ON "cores" ((lower(f_unaccent("nome"))));
