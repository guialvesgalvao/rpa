# ADR 0016 — "Formato" e passos do processo na OP

- **Status:** aceito
- **Data:** 2026-11-13

## Contexto

O cliente pediu duas mudanças no PDF da OP. A primeira: a "Descrição do Processo" passa a ter só os passos usados de fato (antes eram 7). A segunda: o texto do campo **Descrição curta** do cadastro do produto no Bling deve sair na OP, entre "Insumos" e "Descrição do Processo".

A OP lê o pedido pelo `obterVenda` (RPA na sessão web do robô), que traz os itens, os insumos e o id do produto (`itens[].produto.id`), mas não a Descrição curta. A sincronização da plataforma usa a API v3 do Bling com OAuth, mas só a Roma está conectada (ADR 0008), e a OP também roda na ABA. Num diagnóstico de 2026-11-13 (só leitura, autorizado), `GET /Api/v3/produtos/{id}` chamado de dentro da página logada respondeu 200 com `data.descricaoCurta`, a mesma rota que a tela do produto usa.

## Decisão

1. **Passos do processo:** `PASSOS_PROCESSO = ['Off-Set', 'Acoplagem', 'Corte e Vinco']`, nessa ordem, no PDF e no formulário de pré-preenchimento do app. A validação do IPC exige exatamente esse número de linhas.
2. **Fonte do Formato:** depois de ler o `obterVenda`, a OP chama `GET /Api/v3/produtos/{id}` pela própria página logada (`fetch` no contexto da página, sem credencial nova), para cada item que gera OP, no máximo 4 ao mesmo tempo (`src/processes/bling/descricao-curta.ts`). O id precisa ser numérico.
3. **HTML para texto:** a Descrição curta vem do editor rich text do Bling. `<br>` e o fim de parágrafos, blocos e itens de lista viram quebra de linha; as demais tags saem (script e style com o conteúdo); as entidades são decodificadas depois, e o template escapa o resultado.
4. **Bloco "Formato":** no PDF, entre "Insumos (matéria prima)" e "Descrição do Processo", com as quebras de linha mantidas. Produto sem descrição gera a OP sem o bloco.
5. **Falha não bloqueia:** erro ao ler a descrição de um item (rede, status, formato) não impede a OP. O item sai sem o bloco e o log do app registra um aviso com o pedido e o código do item.
6. **Fonte fictícia:** com `RPA_OP_MOCK=1`, a descrição vem de `tests/fixtures/produtos-op.json` (por id, no formato da API), sem rede.

## Alternativas consideradas

| Alternativa                                     | Por que não                                                                            |
| ----------------------------------------------- | -------------------------------------------------------------------------------------- |
| Gravar a Descrição curta na sincronização       | Só a Roma sincroniza; na ABA a OP sairia sem o Formato.                                |
| API v3 com o OAuth da plataforma                | Mesma limitação (só a Roma conectada) e mais uma chamada entre o app e a API.          |
| Abrir a tela do produto e ler o campo na página | Mais lento e frágil (depende do layout), para o mesmo dado que a rota JSON já entrega. |
| Falha na leitura bloquear a OP do item          | O Formato é informativo; travar a produção por ele custa mais que uma OP sem o bloco.  |

## Consequências

- Uma chamada a mais ao Bling por item na leitura dos pedidos da OP.
- O uso de `/Api/v3/produtos/{id}` pela sessão web não é um contrato documentado para esse fim; se o Bling mudar, a OP continua saindo, só que sem o Formato, e o log mostra o motivo.
- Texto muito longo no Formato pode levar a OP a uma segunda página.

## Gatilho de revisão

- O Bling deixar de responder a rota pela sessão web, ou o cliente pedir outro campo do cadastro na OP.
