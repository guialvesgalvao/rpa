# ADR 0015 — Insumo pelo código com letra

- **Status:** aceito
- **Data:** 2026-11-13

## Contexto

A ADR 0012 definiu insumo como o produto ativo com código começando por `TPP`. O cliente explicou a regra real do cadastro no Bling: o código do produto final tem só números; o de insumo tem letra. Com a regra do `TPP`, insumos com outros prefixos ficavam fora de Compras. Além disso, os insumos sincronizados apareciam como produto em Artes (seletor do cadastro de arte e perfil do cliente) e podiam gerar tarefa de arte a partir dos pedidos, embora insumo não tenha arte.

## Decisão

1. **Insumo é o produto com pelo menos uma letra (`[A-Za-z]`) no código.** Código só com números (com ou sem pontuação) é produto final. Produto sem código não é insumo. A expressão fica em `PADRAO_INSUMO` (`plataforma/contratos/src/compras.ts`), usada no JS (`ehCodigoDeInsumo`) e no Postgres (`codigo ~ '[A-Za-z]'`).
2. **Compras:** a lista de insumos e a validação do pedido (`400 insumo_invalido`) usam a regra nova, mantendo produto ativo e da empresa. Substitui o item 1 da ADR 0012.
3. **Artes:** insumos saem do seletor de produto do cadastro de arte (`GET /v1/empresas/:empresa/produtos`) e dos produtos do perfil do cliente (`GET .../clientes/:id/produtos`). As artes já gravadas para um insumo continuam no banco e acessíveis pelo id; só deixam de aparecer nas listas.
4. **Tarefas a partir dos pedidos:** código de insumo no pedido é ignorado antes de buscar o produto: não cria tarefa e não conta como produto ausente.
5. **Dados fictícios:** os produtos finais do seed e da fixture da OP passam a ter código só com números (`91000N`, `900001`, `900002`); os insumos fictícios seguem `TPP000N`.

## Alternativas consideradas

| Alternativa                               | Por que não                                                                                      |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Manter o prefixo `TPP`                    | Não é a regra do cadastro: insumos com outros códigos ficariam fora de Compras.                  |
| Uma lista de prefixos configurável        | Mais um cadastro para manter, e a regra do cliente já é simples (letra = insumo).                |
| Mudar só Compras e deixar Artes como está | Os insumos continuariam no seletor de produto e gerando tarefa de arte, sem nunca ter arte.      |
| Marcar o tipo do produto na sincronização | A regra é do código e vale para produtos cadastrados à mão; exigiria migração e um campo a mais. |

## Consequências

- Um produto final com letra no código some de Artes e a OP deixa de achar a arte dele. A conferência em produção está no plano de deploy.
- Bancos locais semeados antes desta mudança mantêm os códigos antigos (`DEV…`, `XX…`), porque o seed só preenche código vazio; recriar o banco resolve.
- A ADR 0012 continua valendo no resto (módulo, permissões, status, histórico).

## Gatilho de revisão

- O cliente cadastrar produto final com letra no código, ou insumo só com números.
