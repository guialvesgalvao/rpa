CREATE TABLE "compras_historico" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pedido_id" uuid NOT NULL,
	"tipo" text NOT NULL,
	"dados" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"autor_id" uuid,
	"criado_em" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "compras_historico_tipo_valido" CHECK ("compras_historico"."tipo" in ('criacao', 'status', 'responsavel', 'edicao'))
);
--> statement-breakpoint
CREATE TABLE "compras_pedidos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"empresa_id" uuid NOT NULL,
	"produto_id" uuid NOT NULL,
	"quantidade" numeric(12, 3) NOT NULL,
	"observacao" text,
	"status" text DEFAULT 'aberta' NOT NULL,
	"criado_por" uuid,
	"area_criador" text,
	"responsavel_id" uuid,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "compras_pedidos_quantidade_positiva" CHECK ("compras_pedidos"."quantidade" > 0),
	CONSTRAINT "compras_pedidos_observacao_valida" CHECK ("compras_pedidos"."observacao" is null or (btrim("compras_pedidos"."observacao") <> '' and char_length("compras_pedidos"."observacao") <= 500)),
	CONSTRAINT "compras_pedidos_status_valido" CHECK ("compras_pedidos"."status" in ('aberta', 'em_andamento', 'concluida', 'cancelada')),
	CONSTRAINT "compras_pedidos_area_valida" CHECK ("compras_pedidos"."area_criador" in ('arte_finalista', 'producao', 'administracao', 'direcao'))
);
--> statement-breakpoint
ALTER TABLE "compras_historico" ADD CONSTRAINT "compras_historico_pedido_id_compras_pedidos_id_fk" FOREIGN KEY ("pedido_id") REFERENCES "public"."compras_pedidos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compras_historico" ADD CONSTRAINT "compras_historico_autor_id_usuarios_id_fk" FOREIGN KEY ("autor_id") REFERENCES "public"."usuarios"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compras_pedidos" ADD CONSTRAINT "compras_pedidos_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compras_pedidos" ADD CONSTRAINT "compras_pedidos_criado_por_usuarios_id_fk" FOREIGN KEY ("criado_por") REFERENCES "public"."usuarios"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compras_pedidos" ADD CONSTRAINT "compras_pedidos_responsavel_id_usuarios_id_fk" FOREIGN KEY ("responsavel_id") REFERENCES "public"."usuarios"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compras_pedidos" ADD CONSTRAINT "compras_pedidos_produto_empresa_fk" FOREIGN KEY ("produto_id","empresa_id") REFERENCES "public"."produtos"("id","empresa_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "compras_historico_pedido_idx" ON "compras_historico" USING btree ("pedido_id","criado_em");--> statement-breakpoint
CREATE INDEX "compras_pedidos_empresa_status_idx" ON "compras_pedidos" USING btree ("empresa_id","status");--> statement-breakpoint
CREATE INDEX "compras_pedidos_criador_idx" ON "compras_pedidos" USING btree ("criado_por");--> statement-breakpoint
CREATE INDEX "compras_pedidos_responsavel_idx" ON "compras_pedidos" USING btree ("responsavel_id");