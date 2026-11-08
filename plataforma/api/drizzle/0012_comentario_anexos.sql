CREATE TABLE "tarefas_arte_comentario_anexos" (
	"comentario_id" uuid NOT NULL,
	"arquivo_id" uuid NOT NULL,
	"ordem" integer NOT NULL,
	CONSTRAINT "tarefas_arte_comentario_anexos_comentario_id_ordem_pk" PRIMARY KEY("comentario_id","ordem"),
	CONSTRAINT "tarefas_arte_comentario_anexos_arquivo_id_unique" UNIQUE("arquivo_id"),
	CONSTRAINT "tarefas_arte_comentario_anexos_ordem_valida" CHECK ("tarefas_arte_comentario_anexos"."ordem" between 0 and 4)
);
--> statement-breakpoint
ALTER TABLE "tarefas_arte_comentarios" DROP CONSTRAINT "tarefas_arte_comentarios_texto_valido";--> statement-breakpoint
ALTER TABLE "tarefas_arte_comentario_anexos" ADD CONSTRAINT "tarefas_arte_comentario_anexos_comentario_id_tarefas_arte_comentarios_id_fk" FOREIGN KEY ("comentario_id") REFERENCES "public"."tarefas_arte_comentarios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tarefas_arte_comentario_anexos" ADD CONSTRAINT "tarefas_arte_comentario_anexos_arquivo_id_arquivos_id_fk" FOREIGN KEY ("arquivo_id") REFERENCES "public"."arquivos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tarefas_arte_comentarios" ADD CONSTRAINT "tarefas_arte_comentarios_texto_valido" CHECK (char_length("tarefas_arte_comentarios"."texto") <= 2000);