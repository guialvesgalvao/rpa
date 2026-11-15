# ADR 0017 — Cliente final de revenda nas tarefas e nas artes

- **Status:** proposto
- **Data:** 2026-11-15

## Contexto

A Roma vende para revendedores (ex.: ABA Representação), que compram o produto para um cliente deles. No Bling, o pedido de venda sai com o revendedor como cliente, e o nome do cliente final vai no campo **"Nome" da seção "Endereço de entrega"**.

Hoje a tarefa automática diz "Arte de Caixa de Pizza para ABA Representação", sem informar para quem é a arte, e o perfil do cliente mistura as artes de todos os clientes finais. A deduplicação da ADR 0007 (item 6) olha só cliente × produto. Com ela, um revendedor que compra o mesmo produto para outro cliente final não ganharia tarefa nova.

Num diagnóstico de 2026-11-15 (só leitura, autorizado, um pedido real da Roma), a resposta interna da tela do pedido (`obterVenda`) trouxe o nome em `venda.etiqueta_nome`, junto do resto do endereço da etiqueta. É o mesmo conjunto que a API v3 entrega em `transporte.etiqueta`.

## Decisão

1. **Fonte:** a leitura dos pedidos da plataforma (API v3) passa a ler `transporte.etiqueta.nome` e a data do pedido. Campo ausente ou vazio = sem cliente final.
2. **Nome igual ao do cliente:** nome de entrega igual à razão social ou ao nome fantasia do cliente (sem acento, sem diferença de maiúsculas, espaços colapsados) é tratado como pedido normal, sem cliente final.
3. **Armazenamento:** texto (até 120 caracteres) em `tarefas_arte.cliente_final` e `artes.cliente_final` (migração `0020`), cada um com a coluna gerada `cliente_final_chave` (`f_unaccent(lower(...))`, espaços colapsados). Não é um cliente da base: não tem CNPJ.
   - A arte herda o valor da tarefa ao ser concluída.
   - A criação manual da tarefa, o "Inserir arte pronta" e a edição da arte aceitam o campo opcional.
4. **Título:** com cliente final, "Arte de {produto} para {cliente final} ({cliente})" (`tituloTarefa`, site e app).
5. **Deduplicação:** nos pedidos com data a partir de `CLIENTE_FINAL_DESDE` (o dia do deploy), a chave passa a ser cliente × produto × cliente final normalizado.
   - Pedido sem cliente final compara só com tarefas e artes sem cliente final.
   - Pedidos anteriores ao corte seguem a regra da ADR 0007 (cliente × produto), mas gravam o cliente final na tarefa.
6. **Perfil do cliente (site e app):**
   - Cada arte com cliente final mostra o selo "Cliente final: Z", com "· Pedido nº N" quando veio de uma tarefa de pedido.
   - Com algum cliente final no produto, a lista ganha um filtro (todos, cada cliente final, sem cliente final), feito na tela, pois a lista não é paginada.
7. **Busca de clientes:** também acha o revendedor pelo cliente final das artes dele, não das tarefas. A busca por CNPJ da OP no app segue certa, porque filtra o resultado pelo CNPJ exato.

## Alternativas consideradas

| Alternativa                                                 | Por que não                                                                                               |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Só mudar o título                                           | O segundo cliente final do mesmo produto não ganharia tarefa automática.                                  |
| Sempre criar tarefa para pedido com cliente final           | Repetiria a tarefa a cada pedido do mesmo cliente final.                                                  |
| Aplicar a regra nova a todos os pedidos em aberto           | As artes já feitas não têm cliente final; a primeira sincronização recriaria de uma vez as tarefas delas. |
| Cadastrar o cliente final como cliente da base              | Não tem CNPJ nem cadastro no Bling; seria um cliente sem origem, fora da sincronização.                   |
| Preencher o cliente final das artes antigas antes do deploy | Trabalho manual sem ganho para os pedidos novos (decisão do usuário, 2026-11-15).                         |

## Consequências

- Grafias diferentes do mesmo cliente final ("Pizzaria Fictícia" e "Pizz. Ficticia") geram tarefas separadas. A normalização cobre acento, maiúsculas e espaços, não abreviações; a repetida se cancela à mão.
- As artes de revendedores feitas antes do deploy ficam "sem cliente final" no filtro.
- Só a Roma sincroniza (ADR 0008): a regra vale para os pedidos da Roma.
- O app antigo continua funcionando: os campos novos são opcionais nas respostas e no corpo da criação de tarefa, e o título antigo segue sem o cliente final.

## Gatilho de revisão

- O nome de entrega vier em outro campo na API v3 (conferir no primeiro pedido de revenda depois do deploy).
- Pedido de corrigir a grafia do cliente final ou de juntar clientes finais repetidos.
- Busca de clientes lenta por causa do `like` em `artes.cliente_final_chave`.
