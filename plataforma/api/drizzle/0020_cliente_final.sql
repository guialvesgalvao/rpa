ALTER TABLE "artes" ADD COLUMN "cliente_final" text;--> statement-breakpoint
ALTER TABLE "artes" ADD COLUMN "cliente_final_chave" text GENERATED ALWAYS AS (f_unaccent(lower(regexp_replace(btrim(cliente_final), '\s+', ' ', 'g')))) STORED;--> statement-breakpoint
ALTER TABLE "tarefas_arte" ADD COLUMN "cliente_final" text;--> statement-breakpoint
ALTER TABLE "tarefas_arte" ADD COLUMN "cliente_final_chave" text GENERATED ALWAYS AS (f_unaccent(lower(regexp_replace(btrim(cliente_final), '\s+', ' ', 'g')))) STORED;