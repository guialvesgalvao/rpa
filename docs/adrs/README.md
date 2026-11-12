# ADRs

Registros das decisões de arquitetura do projeto. Cada ADR traz contexto, decisão, alternativas descartadas, consequências e o gatilho de revisão.

| Nº                                                  | Decisão                                                      | Status                                                                | Data       |
| --------------------------------------------------- | ------------------------------------------------------------ | --------------------------------------------------------------------- | ---------- |
| [0001](0001-banco-unico-postgres-com-arquivos.md)   | Banco único PostgreSQL, com os arquivos no banco             | aceito; item 2 substituído em parte pela 0006                         | 2026-10-28 |
| [0002](0002-api-fastify-isolada-e-site-nextjs.md)   | API Fastify isolada e site Next.js como BFF                  | aceito                                                                | 2026-10-28 |
| [0003](0003-autenticacao-jwt-propria.md)            | Autenticação JWT própria                                     | aceito; item 7 substituído em parte pela 0005; itens 2 e 8, pela 0011 | 2026-10-28 |
| [0004](0004-integracao-bling-e-agendador-na-api.md) | Integração com o Bling e sincronização agendada na API       | aceito; item 1 substituído em parte pela 0008                         | 2026-11-05 |
| [0005](0005-usuarios-pela-tela.md)                  | Usuários pela tela, com troca de senha pedida na tela        | aceito; itens 1, 2 e 6 substituídos em parte pela 0011                | 2026-11-08 |
| [0006](0006-arquivos-em-bucket-railway.md)          | Arquivos no Storage Bucket do Railway, com fallback em bytea | aceito                                                                | 2026-11-08 |
| [0007](0007-tarefas-de-arte.md)                     | Tarefas de desenvolvimento de arte                           | aceito; item 3 substituído em parte pela 0011                         | 2026-11-08 |
| [0008](0008-conta-do-bling-por-empresa.md)          | Aplicativo e conta do Bling por empresa                      | aceito                                                                | 2026-11-09 |
| [0009](0009-cores-cadastraveis.md)                  | Cores cadastráveis no cadastro da arte                       | aceito                                                                | 2026-11-10 |
| [0010](0010-testes-e2e-locais.md)                   | Testes E2E locais nos planos e na execução                   | aceito                                                                | 2026-11-10 |
| [0011](0011-permissoes-por-modulo.md)               | Permissões por módulo, definidas por empresa                 | aceito                                                                | 2026-11-11 |
| [0012](0012-pedidos-de-compra.md)                   | Pedidos de compra de insumos                                 | aceito                                                                | 2026-11-11 |

Uma decisão nova ganha o próximo número. Para mudar uma decisão aceita, crie um ADR novo e marque o antigo como substituído.
