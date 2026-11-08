ALTER TABLE "arquivos" DROP CONSTRAINT "arquivos_tamanho_confere";--> statement-breakpoint
ALTER TABLE "arquivos" ALTER COLUMN "conteudo" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "arquivos" ADD COLUMN "chave_objeto" text;--> statement-breakpoint
ALTER TABLE "arquivos" ADD CONSTRAINT "arquivos_chave_objeto_unique" UNIQUE("chave_objeto");--> statement-breakpoint
ALTER TABLE "arquivos" ADD CONSTRAINT "arquivos_um_local" CHECK (("arquivos"."conteudo" is null) <> ("arquivos"."chave_objeto" is null));--> statement-breakpoint
ALTER TABLE "arquivos" ADD CONSTRAINT "arquivos_tamanho_confere" CHECK ("arquivos"."tamanho" > 0 and ("arquivos"."conteudo" is null or "arquivos"."tamanho" = octet_length("arquivos"."conteudo")));