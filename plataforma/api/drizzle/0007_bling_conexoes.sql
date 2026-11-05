CREATE TABLE "bling_conexoes" (
	"empresa_id" uuid PRIMARY KEY NOT NULL,
	"access_token_cifrado" text NOT NULL,
	"access_expira_em" timestamp with time zone NOT NULL,
	"refresh_token_cifrado" text NOT NULL,
	"autorizado_por" uuid,
	"autorizado_em" timestamp with time zone NOT NULL,
	"atualizado_em" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bling_conexoes" ADD CONSTRAINT "bling_conexoes_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bling_conexoes" ADD CONSTRAINT "bling_conexoes_autorizado_por_usuarios_id_fk" FOREIGN KEY ("autorizado_por") REFERENCES "public"."usuarios"("id") ON DELETE set null ON UPDATE no action;