# Como gerar uma Ordem de Produção no Bling para testes

Registro do conhecimento levantado em 2026-10-30 e 2026-11-02 para a aba OP do app. Serve para quem precisar de um pedido de teste que já tenha uma Ordem de Produção (OP) gerada pelo Bling, ou para comparar o PDF do Bling com o PDF do app.

## Regras antes de qualquer teste no Bling

- Perguntar ao usuário e obter o **número do pedido** antes de rodar qualquer fluxo com as credenciais do Bling. A autorização vale só para aquela execução (`AGENTS.md`, seção "Testes com credenciais reais").
- Usar só pedidos de teste. Nunca dados reais de clientes.
- A conta da Roma está **sem acesso**; os testes até agora foram feitos na conta ABA.
- Gerar a OP **cria dados no Bling** (no pedido, `existeOrdemProducao` passa a `true`). Os efeitos no estoque dos insumos não foram verificados. Faça isso só em clone de teste.

## Passo a passo: gerar a OP de um pedido de teste (pela tela do Bling)

1. **Clonar** um pedido de venda de teste que tenha um produto com estrutura (por exemplo, um pedido com o produto RA0012). Use o clone, não o pedido original.
2. Na lista de **Pedidos de venda**, marcar o **checkbox** do pedido clonado.
3. No painel da **lateral direita**, clicar em **Mais ações**.
4. Clicar em **Ordens de produção**.
5. Clicar em **Gerar Ordem de Produção**.
6. Conferir o resultado: o pedido passa a ter OP (`existeOrdemProducao = true` na resposta `obterVenda`), e a OP pode ser aberta e impressa em PDF (modelo em `op-example.pdf`, na raiz do repositório).

## Onde ficam os insumos

- Os insumos vêm da **estrutura do produto acabado**. O produto precisa estar com Formato **"Com composição (Kit ou unidade com composição)"** e, para produzir, Produção **"Própria"**.
- No cadastro do produto (`produtos.php#edit/<id>`), a aba **Estrutura** lista os componentes: Componente, Código (SKU), Qtde, Estoque e preços.
- Um produto "Simples" (Formato "Simples (item único e sem variações)") **não tem aba Estrutura nem insumos**. Todos os produtos da Roma devem ter insumos cadastrados; produto sem insumos é erro de cadastro.

## Como o RPA lê o pedido (resposta `obterVenda`)

Capturada ao abrir o pedido na listagem (ver `src/processes/bling/pedido.ts`).

| Dado            | Campo                                                                                                         | Observação                                         |
| --------------- | ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| Data da venda   | `venda.data` (`dd/mm/aaaa`)                                                                                   |                                                    |
| Data prevista   | `venda.dataPrevista`                                                                                          | vazia em todos os pedidos de teste vistos          |
| CNPJ do cliente | `contato.dadosContato.cnpj`, `venda.cnpj`                                                                     | com máscara                                        |
| Cliente         | `contato.dadosContato.fantasia` e `.nome`                                                                     |                                                    |
| Itens           | `itens[]`: `descricao`, `codigo`, `unidade`, `quantidade`, `produto.id`, `produto.tipo`                       | `tipo = "S"` é serviço (ex.: `FRETE`), não vira OP |
| Insumos         | `itens[].componentes[]`: `nome`, `unidade`, `quantidade` (por unidade do item), `idComponente`, `idEstrutura` | vazio (`[]`) para produto Simples                  |
| Já tem OP       | `existeOrdemProducao`                                                                                         | `true` depois de gerar a OP                        |

Atenção sobre as quantidades: `componentes` do pedido (1,0 por unidade nos pedidos 2682 e 2730) difere do cadastro atual do RA0012 (0,50). A OP nº 3, gerada do pedido 2730, mostra 1,00 (igual ao pedido); a OP nº 2, do 2682, mostra 0,50. A causa da diferença não está confirmada (o usuário informou que não alterou nada). Decisão: o app usa as quantidades de `componentes` do pedido; veja o plano `docs/plans/2026-10-29-aba-op-roma.md`, seção "Ordens de produção nº 2 e nº 3".

## Onde ver as OPs geradas

Menu **Ordens de Produção** (`ordens.producao.php#list`). Cada OP mostra o item, a quantidade, o cliente, o nº do pedido de venda, a composição (insumos) e o histórico ("Gerada via pedido de venda").

## Pedidos de teste conhecidos (conta ABA)

| Pedido           | Conteúdo                                                  | Uso                                                                |
| ---------------- | --------------------------------------------------------- | ------------------------------------------------------------------ |
| 2604, 2683, 2684 | EP0006 (produto Simples, sem insumos) e, no 2683, `FRETE` | pedido sem insumos: o app deve registrar erro só para esse produto |
| 2682             | RA0012 (com composição, 2 insumos), já com OP gerada      | pedido com insumos                                                 |
| 2730             | RA0012 (clone do 2682), com OP nº 3 gerada em 02/11/2026  | pedido com insumos e OP gerada a partir de um clone                |

Ordem de serviço `ordem.servicos.php#edit/27232521025` (nº 1): é de serviço, não de produção, sem vínculo com pedido de venda nem com produto acabado; não serve como fonte de insumos.

## Como inspecionar sem alterar nada

Somente leitura: abrir o pedido na listagem e capturar a resposta `obterVenda`, ou abrir o cadastro do produto e navegar nas abas sem clicar em Salvar. Imprimir só a estrutura, com valores sensíveis mascarados. Nunca salvar nem alterar cadastros.
