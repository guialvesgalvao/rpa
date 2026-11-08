CREATE TABLE "tarefas_config" (
	"empresa_id" uuid PRIMARY KEY NOT NULL,
	"responsavel_automatico_id" uuid
);
--> statement-breakpoint
ALTER TABLE "tarefas_arte" ADD COLUMN "origem" text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "tarefas_arte" ADD COLUMN "pedido_numero" text;--> statement-breakpoint
ALTER TABLE "tarefas_config" ADD CONSTRAINT "tarefas_config_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tarefas_config" ADD CONSTRAINT "tarefas_config_responsavel_automatico_id_usuarios_id_fk" FOREIGN KEY ("responsavel_automatico_id") REFERENCES "public"."usuarios"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tarefas_arte" ADD CONSTRAINT "tarefas_arte_origem_valida" CHECK ("tarefas_arte"."origem" in ('manual', 'bling_pedido'));