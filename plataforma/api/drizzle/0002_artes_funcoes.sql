-- Busca sem acento e validação de CNPJ no banco: os dados de clientes entram por INSERT manual,
-- então as regras que dependem do formato ficam aqui, não só na API.
CREATE EXTENSION IF NOT EXISTS unaccent;
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint
-- `unaccent()` é STABLE; este wrapper fixa o dicionário e o declara IMMUTABLE para valer em coluna gerada e em índice.
CREATE OR REPLACE FUNCTION f_unaccent(texto text) RETURNS text
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
AS $$ SELECT public.unaccent('public.unaccent'::regdictionary, texto) $$;
--> statement-breakpoint
-- CNPJ numérico (14 dígitos, sem pontuação) com os dois dígitos verificadores corretos.
CREATE OR REPLACE FUNCTION cnpj_valido(cnpj text) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE STRICT PARALLEL SAFE
AS $$
DECLARE
  pesos1 int[] := ARRAY[5,4,3,2,9,8,7,6,5,4,3,2];
  pesos2 int[] := ARRAY[6,5,4,3,2,9,8,7,6,5,4,3,2];
  soma int;
  resto int;
  dv1 int;
  dv2 int;
BEGIN
  IF cnpj !~ '^[0-9]{14}$' OR cnpj ~ '^(.)\1{13}$' THEN
    RETURN false;
  END IF;

  soma := 0;
  FOR i IN 1..12 LOOP
    soma := soma + substr(cnpj, i, 1)::int * pesos1[i];
  END LOOP;
  resto := soma % 11;
  dv1 := CASE WHEN resto < 2 THEN 0 ELSE 11 - resto END;

  soma := dv1 * pesos2[13];
  FOR i IN 1..12 LOOP
    soma := soma + substr(cnpj, i, 1)::int * pesos2[i];
  END LOOP;
  resto := soma % 11;
  dv2 := CASE WHEN resto < 2 THEN 0 ELSE 11 - resto END;

  RETURN substr(cnpj, 13, 1)::int = dv1 AND substr(cnpj, 14, 1)::int = dv2;
END
$$;
