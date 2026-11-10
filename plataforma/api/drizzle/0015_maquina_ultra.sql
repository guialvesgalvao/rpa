-- Terceira máquina de referência, igual para as duas empresas (idempotente, como a 0005).
INSERT INTO "maquinas" ("nome") VALUES ('Ultra') ON CONFLICT ("nome") DO NOTHING;
