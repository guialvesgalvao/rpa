# ADR 0005 — Usuários pela tela, com troca de senha pedida na tela

- **Status:** aceito
- **Data:** 2026-11-08
- **Substitui em parte:** ADR 0003, item 7 (usuários só por CLI)

## Contexto

Pela ADR 0003, usuários só eram criados pela CLI `usuarios`, executada por quem tem acesso ao banco. O cliente pediu que o admin crie admins e arte finalistas pela tela (site e app), limitado às empresas dele. As empresas e o perfil do token podem estar até 15 minutos desatualizados (ADR 0003).

## Decisão

1. Rotas `GET /v1/usuarios` e `POST /v1/usuarios`, só para admin, fora do escopo de empresa (`/v1/empresas/:empresa`).
2. O admin só vê e cria usuários cujas empresas estão **todas** entre as dele (`podeAtribuirEmpresas` no `contratos`). As empresas e o perfil do admin são lidos do banco a cada chamada, não do token.
3. O admin define a senha inicial (mínimo de 10 caracteres). O usuário criado pela tela nasce com `usuarios.deve_trocar_senha = true`; o login e `GET /v1/eu` devolvem `deveTrocarSenha`.
4. A troca é pedida **só pela tela** (site e app levam à troca antes de qualquer outra tela). A API não bloqueia as outras rotas (decisão do usuário, 2026-11-07).
5. `POST /v1/eu/senha` (qualquer perfil): confere a senha atual, exige nova diferente, desliga a flag e revoga as outras sessões; a sessão de quem troca continua quando o cliente envia o token de renovação dela. Tentativas limitadas pelo mesmo limite do login (5 em 15 min, por usuário).
6. Editar, desativar e trocar a senha de outro usuário continuam só na CLI. Usuários criados pela CLI nascem sem pedido de troca.

## Alternativas consideradas

| Alternativa                                          | Por que não                                                                                          |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Continuar só com a CLI                               | O cliente quer autonomia do admin; a CLI exige acesso ao banco.                                      |
| Convite por e-mail com link de definição de senha    | Exige envio de e-mail (serviço novo, domínio, templates); fora do escopo desta entrega.              |
| Bloquear na API tudo menos a troca enquanto pendente | Mais seguro contra uso direto da API com a senha inicial, mas o usuário escolheu a troca só na tela. |
| Ler as empresas do admin do token                    | O token pode ter até 15 min de atraso; um admin que perdeu uma empresa ainda criaria usuários nela.  |

## Consequências

- Quem chamar a API direto pode continuar usando a senha inicial; o risco fica limitado porque ela só circula entre admin e usuário.
- A tela de usuários não edita nem desativa: correções passam pela CLI.
- O proxy do site ganha o prefixo `/v1/usuarios`; a troca de senha do site passa por `/api/sessao/senha` (o token de renovação está num cookie `httpOnly`).

## Gatilho de revisão

- Pedido de editar/desativar pela tela, ou de convite por e-mail.
- Uso da API por integrações de terceiros: aí a troca obrigatória passa a ser bloqueio na API.
