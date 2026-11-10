# ADR 0009 — Cores cadastráveis no cadastro da arte

- **Status:** aceito
- **Data:** 2026-11-10

## Contexto

A ADR 0001 coloca cores e máquinas como dados de referência vindos de migração: `cores` tinha só `4x0` e `4x4` (migração `0005`). Na produção aparecem muitas outras combinações de cor, e esperar uma migração a cada cor nova trava o cadastro da arte. Máquinas mudam raramente (a Ultra entrou pela migração `0015`).

## Decisão

1. **Cores são criadas na tela**, no próprio cadastro da arte (site e app), só com o nome: `POST /v1/cores`, para os perfis que cadastram arte (admin e arte_finalista). Nome de 1 a 30 caracteres, sem espaços em volta e com os espaços repetidos reduzidos a um.
2. **Continuam globais**, iguais para as duas empresas, sem `empresa_id`, como hoje.
3. **Unicidade sem maiúsculas nem acentos** (`4X4` = `4x4`): índice único em `lower(f_unaccent(nome))` (migração `0016`), como os índices de expressão da `0004`. A API responde 409 `cor_existente`. O formulário confere antes na lista carregada e, se a cor já existe, só a seleciona.
4. **Cache de 1 h da lista de cores:**
   - **Site:** `fetch` do Next com `revalidate: 3600` e a tag `cores`; o proxy `/api/v1/**` chama `revalidateTag('cores', { expire: 0 })` depois de um `POST /v1/cores` com 201. A chave do cache do Next inclui os cabeçalhos, então cada token de acesso tem a própria entrada.
   - **App:** em memória, no processo main. A cor criada pelo próprio app entra na hora; a criada em outro lugar aparece em até 1 h ou ao reiniciar o app.
5. **Máquinas continuam só por migração.**
6. Não há edição nem remoção de cor pela tela.

## Alternativas consideradas

| Alternativa                            | Por que não                                                                                                       |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Continuar com cores só por migração    | Cada cor nova dependeria de um deploy; o cadastro da arte travaria até lá.                                        |
| Cores por empresa (`empresa_id`)       | A cor é especificação de impressão, igual nas duas fábricas; duplicaria `4x0`/`4x4` e mudaria as rotas sem ganho. |
| Unicidade que diferencia maiúsculas    | `4X4` e `4x4` virariam duas cores e confundiriam a escolha na OP.                                                 |
| Sem cache                              | A lista é lida a cada abertura do formulário e muda raramente.                                                    |
| `use cache` (Cache Components) no site | Exigiria ligar `cacheComponents` no site inteiro; o `fetch` com tag resolve só a lista de cores.                  |

## Consequências

- Qualquer admin ou arte-finalista pode criar uma cor, e uma cor errada só sai pelo banco. Se acontecer com frequência, a remoção pela tela vira candidata.
- No site, o cache dura no máximo a vida do token de acesso daquele usuário (até 15 min), não 1 h, porque a chave inclui o cabeçalho `authorization`.
- No app, a cor criada por outra pessoa demora até 1 h para aparecer.
- Os testes da API apagam as cores criadas por eles e mantêm `4x0` e `4x4` (`limparTabelas`).
- Complementa o item da ADR 0001 sobre dados de referência: as cores deixam de vir só por migração; as máquinas continuam.

## Gatilho de revisão

- Pedidos frequentes para corrigir ou remover cores: edição e remoção pela tela, com regra para cores em uso.
- Necessidade de cores diferentes por empresa.
- O cache do site precisar valer entre usuários (ex.: muita leitura): cache por chave fixa ou `use cache`.
