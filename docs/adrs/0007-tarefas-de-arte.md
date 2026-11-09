# ADR 0007 — Tarefas de desenvolvimento de arte

- **Status:** aceito
- **Data:** 2026-11-08

## Contexto

A demo aprovada (2026-11-07) introduziu as tarefas de desenvolvimento de arte sem um registro de decisão. Esta entrega acrescenta atalhos com contador, anexos nos comentários e tarefas criadas automaticamente a partir dos pedidos de venda do Bling.

## Decisão

1. **Modelo:** `tarefas_arte` (cliente × produto da empresa, status, responsável, arte da conclusão), `tarefas_arte_historico` (cada mudança de status, autor nulo = sistema) e `tarefas_arte_comentarios`. "Concluída exige arte" é CHECK no banco; a arte da tarefa não pode ser removida (FK `RESTRICT`).
2. **Status:** Não iniciado, Em desenvolvimento, Aguardando validação do cliente, Concluída, Cancelada; qualquer perfil muda para qualquer um.
3. **Alcance por perfil:** o arte finalista só vê e altera as tarefas de que é responsável (as outras respondem 404); o admin, todas da empresa. Os atalhos (Pendentes, Em andamento, Aguardando validação, Todos) e os contadores seguem o mesmo alcance.
4. **Comentários com anexos:** até 5 por comentário, PDF ou imagem com os limites e a detecção de tipo das artes; texto opcional quando há anexo. Os arquivos seguem a ADR 0006; o download usa o alcance da tarefa.
5. **Origem:** `manual` (tela; responsável = quem cria) ou `bling_pedido` (com o número do pedido).
6. **Tarefas automáticas:** depois de cada sincronização concluída com o Bling, no mesmo job e no mesmo ritmo de chamadas, os pedidos de venda em aberto (situação id 6) com data nos últimos 30 dias geram uma tarefa por cliente × produto sem arte e sem tarefa aberta. A sincronização incremental lê só os pedidos alterados na janela dela e os com data a partir do início dela; a completa (a cada 3 dias) lê os 30 dias. Cliente pelo id do contato no Bling (senão CNPJ) e produto pelo código; os que não estão na base só entram num aviso com contagens. Falha nessa etapa vira aviso, sem derrubar a sincronização.
7. **Responsável automático:** uma arte finalista por empresa, escolhida pelo admin nas Configurações do app (`tarefas_config`); sem escolha (ou se ela deixar de ser elegível), a única arte finalista ativa da empresa; com mais de uma, a tarefa nasce sem responsável (visível ao admin) e o ciclo registra aviso.

## Alternativas consideradas

| Alternativa                                                | Por que não                                                                                 |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Worker separado no Railway para os pedidos                 | Mais um serviço e outra coordenação; o agendador da API já tem lease e ritmo (ADR 0004).    |
| Unicidade de tarefa por cliente × produto no banco         | Uma tarefa concluída ou cancelada pode ter outra depois; a deduplicação olha só as abertas. |
| Distribuir as tarefas automáticas entre as arte finalistas | Pedido do usuário: uma responsável fixa por empresa.                                        |

## Consequências

- Tarefas automáticas sem responsável ficam só para o admin até alguém assumir.
- A leitura dos pedidos depende do escopo de Pedidos de Venda no app do Bling; o formato e o id 6 de "Em aberto" foram confirmados na conta real (2026-11-09).
- Pedidos em aberto com mais de 30 dias não geram tarefa (decisão do usuário, 2026-11-09: a conta tinha 1692 em aberto desde 2024).
- A conexão `roma` usa hoje o login da ABA: o worker lê os pedidos dessa conta (mesma limitação da sincronização).

## Gatilho de revisão

- Formato ou situação dos pedidos diferente do assumido (Task 15).
- Volume de pedidos nos 30 dias que torne lenta a varredura completa, ou pedido de considerar pedidos mais antigos.
