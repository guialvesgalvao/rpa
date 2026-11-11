ALTER TABLE "usuarios" ALTER COLUMN "perfil" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "usuario_empresas" ADD COLUMN "permissoes" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "usuarios" ADD COLUMN "area" text;--> statement-breakpoint
ALTER TABLE "usuarios" ADD COLUMN "excluido_em" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "usuario_empresas" ADD CONSTRAINT "usuario_empresas_permissoes_validas" CHECK ("usuario_empresas"."permissoes" <@ array['artes', 'artes.adicionar', 'artes.editar', 'artes.acompanhar', 'faturas', 'ops', 'usuarios', 'usuarios.permissoes', 'usuarios.editar', 'compras', 'compras.pedir', 'compras.acompanhar']::text[]);--> statement-breakpoint
ALTER TABLE "usuarios" ADD CONSTRAINT "usuarios_area_valida" CHECK ("usuarios"."area" in ('arte_finalista', 'producao', 'administracao', 'direcao'));--> statement-breakpoint
-- Perfis viram permissões em cada empresa do usuário (ADR 0011). Só preenche vínculo ainda sem permissões, então
-- repetir não muda nada. O administrador recebe o catálogo inteiro; a arte-finalista, Artes com "adicionar".
UPDATE "usuario_empresas" SET "permissoes" = array['artes', 'artes.adicionar', 'artes.editar', 'artes.acompanhar', 'faturas', 'ops', 'usuarios', 'usuarios.permissoes', 'usuarios.editar', 'compras', 'compras.pedir', 'compras.acompanhar']::text[]
FROM "usuarios"
WHERE "usuarios"."id" = "usuario_empresas"."usuario_id" AND "usuarios"."perfil" = 'admin' AND "usuario_empresas"."permissoes" = '{}';--> statement-breakpoint
UPDATE "usuario_empresas" SET "permissoes" = array['artes', 'artes.adicionar']::text[]
FROM "usuarios"
WHERE "usuarios"."id" = "usuario_empresas"."usuario_id" AND "usuarios"."perfil" = 'arte_finalista' AND "usuario_empresas"."permissoes" = '{}';
