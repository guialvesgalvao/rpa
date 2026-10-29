-- Índices de expressão (o Drizzle não os modela bem): busca por trigrama, ordem da paginação por cursor e
-- unicidade sem diferenciar maiúsculas nem acentos.
CREATE INDEX "clientes_busca_trgm_idx" ON "clientes" USING gin ("busca" gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX "clientes_ordem_idx" ON "clientes" ("empresa_id", (lower(f_unaccent("nome_exibicao"))), "id");
--> statement-breakpoint
CREATE UNIQUE INDEX "produtos_empresa_nome_unico" ON "produtos" ("empresa_id", (lower(f_unaccent("nome"))));
--> statement-breakpoint
CREATE UNIQUE INDEX "artes_cliente_produto_nome_unico" ON "artes" ("cliente_id", "produto_id", (lower(f_unaccent("nome"))));
