CREATE TABLE "arquivos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nome_original" text NOT NULL,
	"tipo_mime" text NOT NULL,
	"tamanho" integer NOT NULL,
	"sha256" char(64) NOT NULL,
	"conteudo" "bytea" NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "arquivos_tamanho_confere" CHECK ("arquivos"."tamanho" > 0 and "arquivos"."tamanho" = octet_length("arquivos"."conteudo")),
	CONSTRAINT "arquivos_sha256_hex" CHECK ("arquivos"."sha256" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "arte_maquinas" (
	"arte_id" uuid NOT NULL,
	"maquina_id" uuid NOT NULL,
	CONSTRAINT "arte_maquinas_arte_id_maquina_id_pk" PRIMARY KEY("arte_id","maquina_id")
);
--> statement-breakpoint
CREATE TABLE "artes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"empresa_id" uuid NOT NULL,
	"cliente_id" uuid NOT NULL,
	"produto_id" uuid NOT NULL,
	"nome" text DEFAULT 'Padrão' NOT NULL,
	"cor_id" uuid NOT NULL,
	"pdf_id" uuid,
	"imagem_id" uuid,
	"criado_por" uuid,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_por" uuid,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "artes_pdf_id_unique" UNIQUE("pdf_id"),
	CONSTRAINT "artes_imagem_id_unique" UNIQUE("imagem_id"),
	CONSTRAINT "artes_ao_menos_um_arquivo" CHECK ("artes"."pdf_id" is not null or "artes"."imagem_id" is not null),
	CONSTRAINT "artes_nome_preenchido" CHECK (btrim("artes"."nome") <> '')
);
--> statement-breakpoint
CREATE TABLE "clientes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"empresa_id" uuid NOT NULL,
	"razao_social" text NOT NULL,
	"nome_fantasia" text,
	"cnpj" char(14) NOT NULL,
	"nome_exibicao" text GENERATED ALWAYS AS (coalesce(nome_fantasia, razao_social)) STORED,
	"busca" text GENERATED ALWAYS AS (f_unaccent(lower(razao_social || ' ' || coalesce(nome_fantasia, '') || ' ' || cnpj))) STORED,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "clientes_empresa_cnpj_unico" UNIQUE("empresa_id","cnpj"),
	CONSTRAINT "clientes_id_empresa_unico" UNIQUE("id","empresa_id"),
	CONSTRAINT "clientes_cnpj_valido" CHECK ("clientes"."cnpj" ~ '^[0-9]{14}$' and cnpj_valido("clientes"."cnpj")),
	CONSTRAINT "clientes_razao_social_preenchida" CHECK (btrim("clientes"."razao_social") <> ''),
	CONSTRAINT "clientes_nome_fantasia_preenchido" CHECK ("clientes"."nome_fantasia" is null or btrim("clientes"."nome_fantasia") <> '')
);
--> statement-breakpoint
CREATE TABLE "cores" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nome" text NOT NULL,
	CONSTRAINT "cores_nome_unique" UNIQUE("nome")
);
--> statement-breakpoint
CREATE TABLE "maquinas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nome" text NOT NULL,
	CONSTRAINT "maquinas_nome_unique" UNIQUE("nome")
);
--> statement-breakpoint
CREATE TABLE "produtos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"empresa_id" uuid NOT NULL,
	"nome" text NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "produtos_id_empresa_unico" UNIQUE("id","empresa_id"),
	CONSTRAINT "produtos_nome_preenchido" CHECK (btrim("produtos"."nome") <> '')
);
--> statement-breakpoint
ALTER TABLE "arte_maquinas" ADD CONSTRAINT "arte_maquinas_arte_id_artes_id_fk" FOREIGN KEY ("arte_id") REFERENCES "public"."artes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "arte_maquinas" ADD CONSTRAINT "arte_maquinas_maquina_id_maquinas_id_fk" FOREIGN KEY ("maquina_id") REFERENCES "public"."maquinas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artes" ADD CONSTRAINT "artes_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artes" ADD CONSTRAINT "artes_cor_id_cores_id_fk" FOREIGN KEY ("cor_id") REFERENCES "public"."cores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artes" ADD CONSTRAINT "artes_pdf_id_arquivos_id_fk" FOREIGN KEY ("pdf_id") REFERENCES "public"."arquivos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artes" ADD CONSTRAINT "artes_imagem_id_arquivos_id_fk" FOREIGN KEY ("imagem_id") REFERENCES "public"."arquivos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artes" ADD CONSTRAINT "artes_criado_por_usuarios_id_fk" FOREIGN KEY ("criado_por") REFERENCES "public"."usuarios"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artes" ADD CONSTRAINT "artes_atualizado_por_usuarios_id_fk" FOREIGN KEY ("atualizado_por") REFERENCES "public"."usuarios"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artes" ADD CONSTRAINT "artes_cliente_empresa_fk" FOREIGN KEY ("cliente_id","empresa_id") REFERENCES "public"."clientes"("id","empresa_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artes" ADD CONSTRAINT "artes_produto_empresa_fk" FOREIGN KEY ("produto_id","empresa_id") REFERENCES "public"."produtos"("id","empresa_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clientes" ADD CONSTRAINT "clientes_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "produtos" ADD CONSTRAINT "produtos_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "artes_cliente_produto_idx" ON "artes" USING btree ("cliente_id","produto_id");