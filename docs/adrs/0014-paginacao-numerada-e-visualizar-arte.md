# ADR 0014 — Paginação numerada das listas e visualização da arte

- **Status:** aceito
- **Data:** 2026-11-12

## Contexto

A lista de clientes da home de Artes (site e app) era um scroll infinito: cada rolagem até o fim pedia mais 20 clientes pelo cursor (keyset) e a lista crescia sem limite de altura. Com a sincronização do Bling, a Roma passou a ter todos os clientes do Bling na base. A lista de usuários vinha inteira, sem corte. No perfil do cliente, os produtos mostravam só o contador de artes: não havia como ver a arte que está no sistema.

## Decisão

1. **Clientes por página numerada:** `GET /v1/empresas/:empresa/clientes` aceita `pagina` (a partir de 1) com `limite` (1–50, padrão 20) e `busca`, e responde `{ itens, proximoCursor: null, total }`. Usa a mesma condição e ordem do cursor (nome sem acento, id), com `OFFSET` e um `count(*)` com o mesmo filtro; clientes inativos no Bling ficam fora dos itens e do total.
2. **O cursor continua:** sem `pagina`, a rota responde como antes, sem `total`, para o app já instalado e para `clientePorCnpj` (OP). `pagina` e `cursor` juntos: 400 `requisicao_invalida`.
3. **Uma requisição por página, com cache na tela:** o redutor `estado-paginas` (`plataforma/contratos`) é o mesmo no site e no app. Páginas já vistas ficam em memória (voltar não refaz a requisição); busca nova volta à página 1 e limpa o cache; total diferente do conhecido descarta as outras páginas; página além do fim (a lista encolheu) vai para a última. O redutor do scroll (`estado-lista`) foi removido.
4. **Usuários paginados na tela:** 12 por página (`USUARIOS_POR_PAGINA`), cortados no site (`?pagina=N`; inválida vira 1, além do fim vira a última) e no app (página local, mantida ao voltar da edição). A API segue devolvendo todos, porque a edição no site depende da lista inteira.
5. **Controles iguais nos dois lados:** `‹ Anterior 1 … 4 5 6 … 9 Próxima ›`, página atual destacada (`aria-current="page"`) e "Página X de Y · N clientes/usuários"; somem quando há uma página só.
6. **Artes do produto no perfil do cliente:** cada produto vira um botão que expande a lista das artes dele (nome, cor, máquinas, data), buscada na primeira abertura pela rota já existente de artes do produto. Arte com imagem tem **Visualizar imagem**, que abre a imagem num `<dialog>` (fecha pelo botão, pelo Esc e pelo clique fora); arte só com PDF mostra **Sem imagem**. PDF fica fora. Sem permissão nova: as rotas já exigem `artes`.
7. **Como a imagem chega à tela:** no site, `<img>` aponta para o BFF (`/api/v1/.../artes/:id/imagem`), que repassa com o token do cookie. No app, o main busca os bytes pelo canal IPC `artesImagem` (id validado como uuid; `imagemDaArte` confere o tipo pelos bytes), e o renderer monta um `blob:` revogado ao fechar o modal. A CSP do app passa a `img-src 'self' blob:`, só isso (um teste guarda a diretiva).

## Alternativas consideradas

| Alternativa                            | Por que não                                                                                                 |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Manter o scroll infinito               | A altura e o número de requisições crescem sem limite com a base da Roma.                                   |
| Páginas numeradas sobre o cursor       | Pular para a página N exigiria percorrer as anteriores; sem o total, não há "Página X de Y".                |
| Trocar o cursor por `pagina` na API    | Quebraria o app instalado em versão antiga e o `clientePorCnpj` da OP.                                      |
| Paginar usuários na API                | A edição do site acha o usuário na lista inteira; a lista é pequena e já vem inteira.                       |
| Imagem no app como `data:` (base64)    | Abre `data:` na CSP para qualquer imagem e copia os bytes em texto; `blob:` vem só do que o renderer criou. |
| `next/image` no site                   | O otimizador busca a imagem pelo servidor sem a sessão do usuário; a rota exige login.                      |
| Abrir a imagem numa aba ou janela nova | Perde o contexto do cliente e, no app, exigiria outra janela com a mesma sessão.                            |

## Consequências

- Cada página custa um `count(*)` com o filtro da busca; o cache na tela evita repetir a contagem ao voltar. Medir na Roma (Task 8 do plano).
- Com `OFFSET`, uma sincronização do Bling no meio da navegação pode repetir ou pular um cliente entre páginas; recarregar a busca resolve.
- O app instalado em versão antiga continua com o scroll infinito até atualizar.
- A CSP do app aceita `blob:` em imagens; a URL só existe enquanto o modal está aberto.
- Com mais de 12 usuários na ABA, a suíte E2E passaria a ter usuários na página 2; hoje ela fica em até 12.

## Gatilho de revisão

- Contagem lenta na lista de clientes (base muito maior que a da Roma): trocar o total exato por estimativa ou contar só na primeira página.
- Pedido de ver o PDF da arte no perfil do cliente.
- Lista de usuários grande o bastante para pesar inteira: paginar na API.
- Fim do suporte às versões do app que usam o cursor.
