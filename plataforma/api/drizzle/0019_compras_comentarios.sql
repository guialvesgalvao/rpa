CREATE TABLE "compras_comentario_anexos" (
	"comentario_id" uuid NOT NULL,
	"arquivo_id" uuid NOT NULL,
	"ordem" integer NOT NULL,
	CONSTRAINT "compras_comentario_anexos_comentario_id_ordem_pk" PRIMARY KEY("comentario_id","ordem"),
	CONSTRAINT "compras_comentario_anexos_arquivo_id_unique" UNIQUE("arquivo_id"),
	CONSTRAINT "compras_comentario_anexos_ordem_valida" CHECK ("compras_comentario_anexos"."ordem" between 0 and 4)
);
--> statement-breakpoint
CREATE TABLE "compras_comentarios" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pedido_id" uuid NOT NULL,
	"autor_id" uuid,
	"texto" text NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "compras_comentarios_texto_valido" CHECK (char_length("compras_comentarios"."texto") <= 2000)
);
--> statement-breakpoint
ALTER TABLE "compras_comentario_anexos" ADD CONSTRAINT "compras_comentario_anexos_comentario_id_compras_comentarios_id_fk" FOREIGN KEY ("comentario_id") REFERENCES "public"."compras_comentarios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compras_comentario_anexos" ADD CONSTRAINT "compras_comentario_anexos_arquivo_id_arquivos_id_fk" FOREIGN KEY ("arquivo_id") REFERENCES "public"."arquivos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compras_comentarios" ADD CONSTRAINT "compras_comentarios_pedido_id_compras_pedidos_id_fk" FOREIGN KEY ("pedido_id") REFERENCES "public"."compras_pedidos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compras_comentarios" ADD CONSTRAINT "compras_comentarios_autor_id_usuarios_id_fk" FOREIGN KEY ("autor_id") REFERENCES "public"."usuarios"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "compras_comentarios_pedido_idx" ON "compras_comentarios" USING btree ("pedido_id","criado_em");