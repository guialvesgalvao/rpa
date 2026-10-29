-- Cores e máquinas de referência, iguais para as duas empresas (idempotente, como as empresas).
INSERT INTO "cores" ("nome") VALUES ('4x0'), ('4x4') ON CONFLICT ("nome") DO NOTHING;
--> statement-breakpoint
INSERT INTO "maquinas" ("nome") VALUES ('Favorit'), ('Rekord') ON CONFLICT ("nome") DO NOTHING;
