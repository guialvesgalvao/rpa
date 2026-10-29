CREATE TABLE "empresas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"nome" text NOT NULL,
	CONSTRAINT "empresas_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "sessoes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"usuario_id" uuid NOT NULL,
	"origem" text NOT NULL,
	"hash_atual" text NOT NULL,
	"hash_anterior" text,
	"rotacionada_em" timestamp with time zone,
	"expira_em" timestamp with time zone,
	"revogada_em" timestamp with time zone,
	"motivo_revogacao" text,
	"criada_em" timestamp with time zone DEFAULT now() NOT NULL,
	"ultimo_uso_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sessoes_hash_atual_unique" UNIQUE("hash_atual"),
	CONSTRAINT "sessoes_origem_valida" CHECK ("sessoes"."origem" in ('web', 'desktop')),
	CONSTRAINT "sessoes_expiracao_por_origem" CHECK (("sessoes"."origem" = 'web' and "sessoes"."expira_em" is not null) or ("sessoes"."origem" = 'desktop' and "sessoes"."expira_em" is null))
);
--> statement-breakpoint
CREATE TABLE "usuario_empresas" (
	"usuario_id" uuid NOT NULL,
	"empresa_id" uuid NOT NULL,
	CONSTRAINT "usuario_empresas_usuario_id_empresa_id_pk" PRIMARY KEY("usuario_id","empresa_id")
);
--> statement-breakpoint
CREATE TABLE "usuarios" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"nome" text NOT NULL,
	"senha_hash" text NOT NULL,
	"perfil" text NOT NULL,
	"ativo" boolean DEFAULT true NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "usuarios_email_unique" UNIQUE("email"),
	CONSTRAINT "usuarios_email_minusculo" CHECK ("usuarios"."email" = lower("usuarios"."email")),
	CONSTRAINT "usuarios_perfil_valido" CHECK ("usuarios"."perfil" in ('admin', 'arte_finalista'))
);
--> statement-breakpoint
ALTER TABLE "sessoes" ADD CONSTRAINT "sessoes_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usuario_empresas" ADD CONSTRAINT "usuario_empresas_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usuario_empresas" ADD CONSTRAINT "usuario_empresas_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sessoes_usuario_idx" ON "sessoes" USING btree ("usuario_id");--> statement-breakpoint
CREATE INDEX "sessoes_hash_anterior_idx" ON "sessoes" USING btree ("hash_anterior");