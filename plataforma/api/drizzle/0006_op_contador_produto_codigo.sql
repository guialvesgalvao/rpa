CREATE TABLE "op_contadores" (
	"empresa_id" uuid PRIMARY KEY NOT NULL,
	"ultimo" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "op_contadores_ultimo_nao_negativo" CHECK ("op_contadores"."ultimo" >= 0)
);
--> statement-breakpoint
ALTER TABLE "produtos" ADD COLUMN "codigo" text;--> statement-breakpoint
ALTER TABLE "op_contadores" ADD CONSTRAINT "op_contadores_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "produtos" ADD CONSTRAINT "produtos_empresa_codigo_unico" UNIQUE("empresa_id","codigo");--> statement-breakpoint
ALTER TABLE "produtos" ADD CONSTRAINT "produtos_codigo_preenchido" CHECK ("produtos"."codigo" is null or btrim("produtos"."codigo") <> '');