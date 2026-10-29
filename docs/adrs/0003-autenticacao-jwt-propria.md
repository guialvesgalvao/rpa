# ADR 0003 — Autenticação JWT própria

- **Status:** aceito
- **Data:** 2026-10-28

## Contexto

Os usuários são internos e criados só por CLI. Cada um tem um perfil (`admin` ou `arte_finalista`) e uma lista de empresas (`aba`, `roma`). Há duas origens de sessão com necessidades diferentes:

- `web`: o site, com sessão que expira por inatividade;
- `desktop`: o app, com sessão que só termina no logout.

A API é a única dona das regras (ADR 0002) e roda com 1 réplica.

## Decisão

1. Tokens com `jose`, HS256, segredo `JWT_SEGREDO` (≥ 32 bytes) só na API, `iss`/`aud` fixos.
2. Acesso: JWT de 15 min com `sub`, `perfil` e `empresas`.
3. Renovação: token opaco de 32 bytes, guardado como SHA-256 na tabela `sessoes`, **rotativo**. Reuso do token anterior até 60 s após a rotação é corrida (rotaciona de novo); depois disso é roubo (revoga a sessão).
4. Sessão `web` expira após 30 dias sem uso (o prazo desliza a cada renovação). Sessão `desktop` não expira: termina no logout, na desativação do usuário ou na revogação.
5. Senhas com `scrypt` nativo (N=2^15, r=8, p=3, maxmem 64 MiB), normalização NFKC e comparação com `timingSafeEqual`. Login inexistente também roda um hash, para o tempo de resposta não revelar e-mails.
6. Limite de tentativas: 5 falhas por e-mail em 15 min, em memória. A mensagem é sempre "E-mail ou senha inválidos".
7. Usuários só por CLI (`criar`, `senha`, `empresas`, `desativar`, `listar`); desativar revoga as sessões. Usuário sem empresa não entra (403).
8. Autorização por plugin: `exigirUsuario` (Bearer → usuário ativo), `exigirEmpresa` (slug nas empresas do token) e `exigirPerfil`.

## Alternativas consideradas

| Alternativa | Por que não                                                                                                                                                                                                                                                                                                  |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Better Auth | A política pedida (sessão desktop sem expiração, rotação com janela de corrida de 60 s, perfil e empresas no token, usuários só por CLI) é pequena e específica; com `jose`, o esquema de `sessoes` e as regras ficam sob controle do projeto, sem tabelas e fluxos (cadastro, OAuth) que não seriam usados. |

## Consequências

- `exigirEmpresa` e `exigirPerfil` confiam no token: tirar uma empresa, mudar o perfil ou sair só valem nas rotas protegidas quando o acesso expira (até 15 min). `GET /v1/eu` e a renovação leem o banco.
- A janela de 60 s enfraquece um pouco a detecção de roubo. Os clientes devem serializar a renovação: quem renova com um token já deslocado depois de 60 s perde a sessão.
- O limite de tentativas zera a cada deploy e permite travar a conta de alguém por 15 min.
- Renovação de usuário sem empresa responde 403 `sem_empresa`; os clientes deslogam só no 401.
- Não há troca de senha pelo usuário; `usuarios senha` não revoga as sessões abertas.
- A API não sobe sem `DATABASE_URL` e `JWT_SEGREDO`.

## Gatilho de revisão

- A API passar a ter mais de 1 réplica: o limite de tentativas precisa sair da memória.
- Precisar de corte imediato de acesso: conferir empresas e sessão no banco a cada requisição.
- Usuários externos, cadastro próprio ou SSO.
