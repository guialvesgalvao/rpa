CREATE TABLE "bling_sincronizacoes" (
	"empresa_id" uuid PRIMARY KEY NOT NULL,
	"incremental_desde" timestamp with time zone,
	"ultima_completa_em" timestamp with time zone,
	"em_execucao_desde" timestamp with time zone,
	"ultimo_resultado" jsonb,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "clientes" ADD COLUMN "id_bling" bigint;--> statement-breakpoint
ALTER TABLE "clientes" ADD COLUMN "inativo_no_bling_em" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "produtos" ADD COLUMN "id_bling" bigint;--> statement-breakpoint
ALTER TABLE "produtos" ADD COLUMN "inativo_no_bling_em" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "bling_sincronizacoes" ADD CONSTRAINT "bling_sincronizacoes_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clientes" ADD CONSTRAINT "clientes_empresa_id_bling_unico" UNIQUE("empresa_id","id_bling");--> statement-breakpoint
ALTER TABLE "produtos" ADD CONSTRAINT "produtos_empresa_id_bling_unico" UNIQUE("empresa_id","id_bling");