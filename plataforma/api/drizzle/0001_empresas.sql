-- Empresas de referência (decisão 10: dados de referência entram por migração idempotente).
INSERT INTO "empresas" ("slug", "nome") VALUES
  ('aba', 'ABA Embalagens'),
  ('roma', 'Roma Embalagens')
ON CONFLICT ("slug") DO NOTHING;
