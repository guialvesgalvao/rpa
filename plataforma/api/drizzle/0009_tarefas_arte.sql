CREATE TABLE "tarefas_arte" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"empresa_id" uuid NOT NULL,
	"cliente_id" uuid NOT NULL,
	"produto_id" uuid NOT NULL,
	"responsavel_id" uuid,
	"status" text DEFAULT 'nao_iniciada' NOT NULL,
	"arte_id" uuid,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tarefas_arte_status_valido" CHECK ("tarefas_arte"."status" in ('nao_iniciada', 'em_desenvolvimento', 'aguardando_cliente', 'concluida', 'cancelada')),
	CONSTRAINT "tarefas_arte_concluida_com_arte" CHECK ("tarefas_arte"."status" <> 'concluida' or "tarefas_arte"."arte_id" is not null)
);
--> statement-breakpoint
CREATE TABLE "tarefas_arte_comentarios" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tarefa_id" uuid NOT NULL,
	"autor_id" uuid,
	"texto" text NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tarefas_arte_comentarios_texto_valido" CHECK (btrim("tarefas_arte_comentarios"."texto") <> '' and char_length("tarefas_arte_comentarios"."texto") <= 2000)
);
--> statement-breakpoint
CREATE TABLE "tarefas_arte_historico" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tarefa_id" uuid NOT NULL,
	"status_anterior" text,
	"status_novo" text NOT NULL,
	"autor_id" uuid,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tarefas_arte_historico_status_valido" CHECK (("tarefas_arte_historico"."status_anterior" is null or "tarefas_arte_historico"."status_anterior" in ('nao_iniciada', 'em_desenvolvimento', 'aguardando_cliente', 'concluida', 'cancelada')) and "tarefas_arte_historico"."status_novo" in ('nao_iniciada', 'em_desenvolvimento', 'aguardando_cliente', 'concluida', 'cancelada'))
);
--> statement-breakpoint
ALTER TABLE "tarefas_arte" ADD CONSTRAINT "tarefas_arte_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tarefas_arte" ADD CONSTRAINT "tarefas_arte_responsavel_id_usuarios_id_fk" FOREIGN KEY ("responsavel_id") REFERENCES "public"."usuarios"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tarefas_arte" ADD CONSTRAINT "tarefas_arte_arte_id_artes_id_fk" FOREIGN KEY ("arte_id") REFERENCES "public"."artes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tarefas_arte" ADD CONSTRAINT "tarefas_arte_cliente_empresa_fk" FOREIGN KEY ("cliente_id","empresa_id") REFERENCES "public"."clientes"("id","empresa_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tarefas_arte" ADD CONSTRAINT "tarefas_arte_produto_empresa_fk" FOREIGN KEY ("produto_id","empresa_id") REFERENCES "public"."produtos"("id","empresa_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tarefas_arte_comentarios" ADD CONSTRAINT "tarefas_arte_comentarios_tarefa_id_tarefas_arte_id_fk" FOREIGN KEY ("tarefa_id") REFERENCES "public"."tarefas_arte"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tarefas_arte_comentarios" ADD CONSTRAINT "tarefas_arte_comentarios_autor_id_usuarios_id_fk" FOREIGN KEY ("autor_id") REFERENCES "public"."usuarios"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tarefas_arte_historico" ADD CONSTRAINT "tarefas_arte_historico_tarefa_id_tarefas_arte_id_fk" FOREIGN KEY ("tarefa_id") REFERENCES "public"."tarefas_arte"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tarefas_arte_historico" ADD CONSTRAINT "tarefas_arte_historico_autor_id_usuarios_id_fk" FOREIGN KEY ("autor_id") REFERENCES "public"."usuarios"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tarefas_arte_empresa_status_idx" ON "tarefas_arte" USING btree ("empresa_id","status");--> statement-breakpoint
CREATE INDEX "tarefas_arte_responsavel_idx" ON "tarefas_arte" USING btree ("responsavel_id");--> statement-breakpoint
CREATE INDEX "tarefas_arte_comentarios_tarefa_idx" ON "tarefas_arte_comentarios" USING btree ("tarefa_id","criado_em");--> statement-breakpoint
CREATE INDEX "tarefas_arte_historico_tarefa_idx" ON "tarefas_arte_historico" USING btree ("tarefa_id","criado_em");