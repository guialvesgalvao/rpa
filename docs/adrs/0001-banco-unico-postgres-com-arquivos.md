# ADR 0001 — Banco único PostgreSQL, com os arquivos no banco

- **Status:** aceito
- **Data:** 2026-10-28

## Contexto

A plataforma (`plataforma/`) guarda usuários, empresas, perfis e sessões e, depois, clientes, produtos e artes. Cada arte tem ao menos um arquivo: PDF de até 25 MB ou imagem JPG, PNG ou WebP de até 10 MB. Clientes e produtos são inseridos pelo usuário direto no banco, então as regras críticas precisam viver no banco, não só na API.

Restrições:

- só existe o ambiente de produção, no Railway; o desenvolvimento usa Docker local;
- a regra da organização proíbe `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` em implementações e prefere credenciais temporárias.

## Decisão

1. Um único PostgreSQL 18 no Railway para todos os dados, inclusive os arquivos.
2. Arquivos em `bytea`, numa tabela `arquivos` separada (`nome_original`, `tipo_mime`, `tamanho`, `sha256`, `conteudo`), referenciada pelas artes. A tabela chega com as Artes; o tipo do arquivo é conferido pela assinatura do conteúdo.
3. Acesso pelo Drizzle ORM (`drizzle-orm` 0.45, fixado) com o driver `postgres` (postgres.js). O esquema fica em `plataforma/api/src/db/esquema.ts`.
4. Migrações SQL versionadas em `plataforma/api/drizzle/`: geradas pelo `drizzle-kit generate` ou escritas à mão (`--custom`) quando o SQL vai além do esquema (CHECKs, colunas geradas, extensões).
5. Dados de referência (empresas, depois cores e máquinas) entram por migração SQL idempotente (`ON CONFLICT DO NOTHING`), não por seed.
6. Em produção, as migrações rodam no pre-deploy do serviço `api` (`npm -w @plataforma/api run db:migrar`), que usa a rede privada do Railway e barra o deploy se falhar. Confirmado no primeiro deploy (2026-10-28).
7. Desenvolvimento e testes usam Postgres 18 real no Docker (`plataforma/docker-compose.yml`, porta 5433, bancos `rpa` e `rpa_teste`) e um serviço `postgres:18` no CI.

## Alternativas consideradas

| Alternativa                                            | Por que não                                                                                                                                                                                                                      |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Bucket do Railway (compatível com S3) para os arquivos | O acesso usa chave e segredo fixos, o que esbarra na regra da organização contra credenciais fixas. Continua como destino se o volume de arquivos crescer (ver Gatilho de revisão).                                              |
| Volume do Railway (disco no serviço da API)            | O disco fica preso ao serviço da API, fora das transações e do backup do banco; manter arte e arquivo consistentes exigiria coordenação manual.                                                                                  |
| Prisma como ORM                                        | O Drizzle mantém o esquema em TypeScript sem uma etapa de geração de cliente, entra no build com esbuild (`dist/migrar.mjs`) e aceita migrações SQL escritas à mão, necessárias para CHECKs, colunas geradas e índices de busca. |

## Consequências

- Um só backup cobre dados e arquivos, e a gravação da arte com seus arquivos pode ser uma transação.
- O GB no Postgres custa cerca de 10× o de um bucket; backup e PITR crescem com os arquivos.
- Cada upload ocupa até 25 MB de memória na API; os limites de tamanho são a proteção.
- Regras críticas ficam no banco (CHECK, FKs compostas, colunas geradas), porque há inserção manual.
- O `drizzle-kit` 0.31 traz um esbuild antigo com alerta moderado, usado só em desenvolvimento (`db:gerar`).

## Gatilho de revisão

- A tabela `arquivos` perto de ~20 GB: migrar os arquivos para um bucket, com credenciais compatíveis com a regra da organização.
- Saída do `drizzle-kit` 1.0: rever a fixação de versão e o alerta do esbuild.
