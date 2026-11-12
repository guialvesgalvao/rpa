# ADR 0012 — Pedidos de compra de insumos

- **Status:** aceito
- **Data:** 2026-11-11

## Contexto

O cliente pediu um módulo **Compras** no site e no app. Alguém da fábrica pede um insumo, e quem cuida das compras assume o pedido e o leva até o fim, como as tarefas de arte. Os insumos já existem no Bling como produtos com código começando por `TPP`. A sincronização (ADR 0004) já grava todos os produtos ativos com código na tabela `produtos`, e só a Roma sincroniza (`EMPRESAS_SINCRONIZACAO_BLING`). As permissões são por módulo e por empresa (ADR 0011).

## Decisão

1. **Insumo** é o produto ativo da empresa (sem `inativo_no_bling_em`) com `codigo` começando por `TPP` (`PREFIXO_INSUMO`, comparação exata de maiúsculas). Não há chamada nova ao Bling: a lista vem do que a sincronização gravou.
2. **Só nas empresas com sincronização do Bling** (`empresaTemCompras`, hoje a Roma). Nas demais, as rotas respondem 404 `compras_indisponivel`, e o menu do site, a aba do app e o painel de permissões não mostram o módulo.
3. **Tabelas próprias**, sem generalizar as de arte:
   - `compras_pedidos` (migração `0018`): insumo, `quantidade numeric(12,3) > 0`, observação de até 500 caracteres, status com CHECK, criador, `area_criador` (cópia da área no momento do pedido), responsável e datas. O insumo precisa ser da mesma empresa (FK composta).
   - `compras_historico`: um evento por mudança, com `tipo` (`criacao`, `status`, `responsavel`, `edicao`) e o antes/depois em `dados` (jsonb), com os nomes do momento.
   - `compras_comentarios` e `compras_comentario_anexos` (migração `0019`).

   Os helpers de arquivo são compartilhados com artes e tarefas: `arquivos/gravar.ts` e `rotas/multipart-comentario.ts`.

4. **Status:** Aberta, Em andamento, Concluída e Cancelada. Insumo, quantidade e observação são editáveis enquanto o pedido está Aberta ou Em andamento.
5. **Permissões e alcance:**
   - `compras`: abrir o módulo e ver os próprios pedidos.
   - `compras.pedir`: criar pedidos, ver a lista de insumos e editar os próprios pedidos.
   - `compras.acompanhar`: ver todos os pedidos da empresa, assumir, mudar para qualquer status, editar e comentar em qualquer um.

   Pedido fora do alcance responde 404. O criador pode cancelar o próprio pedido enquanto está Aberta. Trocar o insumo pela tela exige `compras.pedir`, porque a lista de insumos é dessa permissão.

6. **Assumir** define o responsável e passa o pedido para Em andamento, gravando um evento para cada mudança, na ordem. Quem acompanha pode assumir no lugar de outra pessoa; assumir de novo não gera evento.
7. **Toda mudança grava o evento na mesma transação**, com `SELECT … FOR UPDATE` na linha do pedido. O mesmo status ou um valor igual não geram evento. `criado_em` do histórico usa `clock_timestamp()` para ordenar os dois eventos do "assumir".
8. **Lista:**
   - `meus` (padrão): os que criei ou de que sou responsável;
   - `abertos`: Aberta e Em andamento;
   - `todos`.

   O filtro de status é opcional. Quem não acompanha só recebe os próprios, qualquer que seja o escopo.

9. **Comentários com anexo** no molde das tarefas de arte (ADR 0007): texto de até 2000 caracteres, até 5 anexos PDF (25 MB) ou imagem (10 MB) e texto opcional com anexo. O download usa o alcance do pedido. Pedido terminado continua aceitando comentário.
10. **Arquivos no bucket:** os anexos seguem a ADR 0006, com o mesmo bucket do Railway. A exceção à regra de credenciais fixas aprovada lá cobre também este módulo, com as mesmas condições e o mesmo gatilho de revisão.

## Alternativas consideradas

| Alternativa                                              | Por que não                                                                                                                                          |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Generalizar as tabelas de tarefas de arte para "tarefas" | As tarefas de arte têm cliente, produto, arte da conclusão e status próprios; misturar exigiria colunas opcionais e CHECKs condicionais em produção. |
| Ler os insumos do Bling na hora                          | Chamada nova, com ritmo e escopo do app do Bling; a sincronização já grava os produtos.                                                              |
| Cadastro próprio de insumos                              | Duplicaria o que já está no Bling e sairia de sincronia.                                                                                             |
| Quantidade inteira                                       | Decisão do usuário (2026-11-10): quantidade numérica com decimais; três casas, como na coluna `numeric(12,3)`.                                       |
| Liberar Compras na ABA                                   | A ABA não sincroniza com o Bling, então não teria insumos.                                                                                           |

## Consequências

- A lista de insumos depende da sincronização. Se os `TPP` ainda não estiverem no banco de produção, a lista vem vazia até uma sincronização completa.
- Um insumo que fica inativo no Bling continua nos pedidos já feitos, mas não pode ser escolhido de novo.
- A área do pedido não muda se a área do criador mudar depois.
- No site e no app (`lerQuantidade`), "1.234" sem vírgula vira 1,234, e não mil duzentos e trinta e quatro: o ponto único conta como decimal; "1.234,5" e "1,5" valem como no formato brasileiro.
- Até 5 anexos de 25 MB são lidos em memória por requisição, como nas tarefas de arte.

## Gatilho de revisão

- Outra empresa passar a sincronizar com o Bling, ou insumos sem o prefixo `TPP`.
- Pedido de vários insumos por pedido, de fornecedor, de preço ou de integração com o pedido de compra do Bling.
- Fim da exceção de credenciais fixas da ADR 0006.
