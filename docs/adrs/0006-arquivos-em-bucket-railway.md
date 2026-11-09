# ADR 0006 — Arquivos no Storage Bucket do Railway, com fallback em bytea

- **Status:** proposto (depende da exceção do item 2)
- **Data:** 2026-11-08
- **Substitui em parte:** ADR 0001, item 2 (arquivos em `bytea`)

## Contexto

A ADR 0001 guardou os arquivos das artes em `bytea` no Postgres e recusou o bucket do Railway porque ele usa chave e segredo fixos, contra a regra da organização (credenciais temporárias). Os anexos dos comentários das tarefas (até 5 por comentário, PDF de até 25 MB ou imagem de até 10 MB) aumentam o volume de arquivos, e o GB no Postgres custa cerca de 10× o de um bucket.

## Decisão

1. Todo arquivo novo (artes e anexos) vai para um **Railway Storage Bucket** (compatível com S3, privado), quando as cinco variáveis `ARQUIVOS_S3_*` estão definidas no serviço `api` por variable reference. Cliente: `@aws-sdk/client-s3`.
2. **Exceção à regra de credenciais fixas:** _a preencher na Task 10 — quem aprovou, quando e com que condições._ Sem essa aprovação, produção não recebe as variáveis e continua em `bytea`.
3. A API é a porta de entrada: upload e download passam por ela; o bucket é privado e não há URL pré-assinada (a CSP do app só aceita `'self'`).
4. A tabela `arquivos` mantém os metadados e guarda **ou** `conteudo` (bytea) **ou** `chave_objeto` (CHECK "exatamente um"; migração `0011`).
5. Ordem banco × bucket: o objeto é gravado antes da transação e apagado se ela falhar; ao trocar ou remover, a linha sai primeiro e o objeto depois (falha só em log, com a chave; o objeto fica órfão e é limpo à mão).
6. Sem as variáveis, a API segue em `bytea` (desenvolvimento sem S3 e produção antes da migração). Arquivos antigos em `bytea` continuam legíveis com o bucket ligado.
7. Os arquivos atuais vão para o bucket pelo script idempotente `arquivos:migrar` (grava, lê de volta, confere tamanho e sha256 e só então zera o `conteudo`), executado pelo usuário via `railway run`.
8. Desenvolvimento e testes usam o **S3Mock** (`adobe/s3mock`) no `docker-compose` e no CI. O MinIO previsto no plano não tem mais imagem pública disponível (Docker Hub e quay.io recusaram em 2026-11-08).

## Alternativas consideradas

| Alternativa                       | Por que não                                                                                                                                                |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Manter tudo em `bytea` (ADR 0001) | Custo por GB e crescimento do backup com os anexos.                                                                                                        |
| MongoDB/GridFS                    | Segundo banco, sem transação com o Postgres, e não reduz o custo de guardar arquivo.                                                                       |
| Volume do Railway                 | Disco preso ao serviço da API, fora do backup e das transações.                                                                                            |
| URL pré-assinada direto no bucket | Exigiria liberar o domínio do bucket na CSP do app e espalhar a lógica de expiração; a API como porta de entrada mantém o controle de acesso num lugar só. |

## Consequências

- Credenciais fixas do bucket existem no painel do Railway (variable reference), nunca em arquivo ou chat; vazamento exige rotação manual.
- Backup do banco deixa de cobrir os arquivos novos: o bucket precisa da própria política de retenção.
- Objetos órfãos são possíveis (remoção que falha depois de apagar a linha); só aparecem no log.
- Download passa pela API (stream), sem carregar o arquivo inteiro na memória quando vem do bucket.

## Gatilho de revisão

- Railway oferecer credenciais temporárias para buckets: trocar as fixas.
- Volume ou custo do bucket fora do esperado, ou necessidade de servir arquivos sem passar pela API.
