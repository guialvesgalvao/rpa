# ADR 0013 — Redefinição de senha pelo painel e Minha conta

- **Status:** aceito
- **Data:** 2026-11-12
- **Substitui em parte:** ADR 0005, item 6 (trocar a senha de outro usuário só na CLI)

## Contexto

Pela ADR 0005, trocar a senha de outro usuário só era possível pela CLI `usuarios senha`, que exige acesso ao banco. Quem esquecia a senha dependia de alguém com esse acesso. Além disso, `POST /v1/eu/senha` só era alcançável pela tela forçada de primeiro acesso: depois dela, o usuário não tinha como trocar a própria senha. O painel de usuários já edita e exclui por permissão (ADR 0011).

## Decisão

1. **Redefinição pelo painel:** `POST /v1/empresas/:empresa/usuarios/:id/senha` com `{ novaSenha }`, no site e no app (card "Redefinir senha" na edição do usuário). Exige `usuarios.editar` em **todas** as empresas do alvo, a mesma regra do `PATCH` de dados (ADR 0011, item 7).
2. **Senha temporária:** a senha redefinida liga `deve_trocar_senha`. O usuário entra com ela e é levado à troca, como no cadastro (ADR 0005, itens 3 e 4). Mínimo de 10 caracteres (`SENHA_MINIMA`).
3. **Sem revogar sessões:** as sessões abertas do usuário continuam até expirar ou até ele sair. A CLI `usuarios senha` continua como estava.
4. **Ninguém redefine a própria senha pelo painel** (409 `proprio_usuario`, como na exclusão). Para si, usa a Minha conta, que exige a senha atual.
5. **Minha conta:** o nome do usuário, no rodapé do menu (site e app), abre uma tela com o nome, o e-mail e a troca de senha (atual, nova e confirmação). Usa `POST /v1/eu/senha` sem mudança: confere a atual, revoga as outras sessões e mantém a de quem troca. Qualquer usuário logado acessa, mesmo sem permissão nenhuma; não há permissão nova no catálogo.
6. **No site**, a Minha conta (`/{empresa}/conta`) reaproveita o BFF `/api/sessao/senha` com `retorno=conta`. O destino é uma lista fechada: só a conta da empresa informada (slug válido); qualquer outro valor segue o fluxo do primeiro acesso.
7. **Campos de senha com "olhinho"** (mostrar/ocultar) nos formulários novos: `CampoSenha` no site e `comOlho` no app.
8. **Auditoria:** a API registra `{ usuarioId, alvoId }` e o app `{ usuarioId }`. A senha nunca é registrada.

## Alternativas consideradas

| Alternativa                                         | Por que não                                                                                                    |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Continuar só com a CLI                              | Quem esquece a senha depende de quem tem acesso ao banco.                                                      |
| "Esqueci a senha" com link por e-mail               | Exige envio de e-mail (serviço novo, domínio, templates); fora do escopo, como na ADR 0005.                    |
| Revogar as sessões do usuário ao redefinir          | Decisão do usuário: as sessões atuais seguem. Fica como revogação opcional num plano futuro.                   |
| Senha redefinida definitiva (sem troca obrigatória) | A senha combinada fora do sistema ficaria conhecida de quem redefiniu.                                         |
| Permissão própria para redefinir senha              | `usuarios.editar` já cobre os dados do usuário inteiro, com a mesma regra de todas as empresas.                |
| Minha conta como permissão do catálogo              | Trocar a própria senha vale para qualquer usuário logado; uma permissão só criaria quem não consegue trocá-la. |

## Consequências

- Quem teve a senha vazada continua logado até a sessão terminar (acesso de 15 min, renovação até a revogação). A troca pela Minha conta, ao contrário, revoga as outras sessões.
- A senha temporária fica conhecida de quem a redefiniu até o próximo login do usuário, quando ele é obrigado a trocá-la. Quem chamar a API direto pode seguir com ela (ADR 0005).
- `/api/sessao/senha` atende dois fluxos (primeiro acesso e Minha conta); os testes cobrem os dois caminhos e o destino fechado.
- Os campos de senha do primeiro acesso e do cadastro no app continuam sem o olhinho.

## Gatilho de revisão

- Pedido de "esqueci a senha" sem ajuda de outra pessoa, ou de convite por e-mail.
- Pedido de cortar as sessões ao redefinir a senha (vazamento, saída de alguém da empresa).
- Uso da API por integrações de terceiros: a troca obrigatória passa a ser bloqueio na API (ADR 0005).
