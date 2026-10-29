# AGENTS.md

## Projeto

RPA do Bling em Node/TypeScript/Playwright, com CLI (`src/cli.ts`) e app Electron (`src/app/`). Detalhes de instalação, configuração e uso no `README.md`.

Decisões de arquitetura em `docs/adrs/` (índice no `README.md` da pasta).

## Comandos

- `npm run typecheck`
- `npm run lint`
- `npx prettier --check src tests` — o `npm run format:check` roda em `.` e pega os planos locais de `docs/plans/`, então falha localmente; prefira caminhos explícitos.
- `npm test` — precisa do Chromium do Playwright (`npm run browsers:install`), usado pelo teste de integração do PDF do recibo.
- `npm run app`

## Fluxo de branches

- A `main` é a branch estável.
- Cada pacote de alterações vai numa branch criada a partir da `main` atualizada (`feat/…`, `fix/…`).
- O merge na `main` só acontece depois da validação manual do usuário.
- Nunca rodar `git commit`, `git push` nem merge sem confirmação explícita do usuário para aquela ação.
- Mensagens de commit em inglês, frase no imperativo, sem prefixo convencional (padrão do `git log`).

## Releases

- Merge na `main` não gera versão.
- Uma versão nova (`npm version …` + `git push --follow-tags`, que dispara `.github/workflows/release.yml`) só sai quando o usuário pedir.
- Nunca criar nem enviar tag por conta própria.

## Plataforma

- `plataforma/` (API Fastify + contratos zod) tem tooling próprio; o lint e o prettier da raiz a ignoram. Detalhes no `plataforma/README.md`.
- Comandos: `npm --prefix plataforma ci`, depois `npm --prefix plataforma run typecheck|lint|format:check|test|build`.
- Banco local: `docker compose -f plataforma/docker-compose.yml up -d --wait` (Postgres 18 na porta 5433, só desenvolvimento).
- Nunca ler arquivos `.env*` (exceto `.env.example`) nem pedir credenciais no chat.
- Credenciais do Railway ficam só no painel; scripts locais as recebem via `railway run`, executado pelo usuário.
- A plataforma não usa as tags `v*` (são do app).

## Testes com credenciais reais (OBRIGATÓRIO)

- **Sempre** perguntar ao usuário, antes de rodar qualquer fluxo que use as credenciais do Bling (app → Gerar, `npm run process -- bling …`, scripts de diagnóstico), se pode rodar e qual número de pedido usar.
- A autorização vale só para aquela execução. Sem resposta, não rodar.
- Nunca usar dados reais de clientes em testes ou fixtures.

## Planos

- `docs/plans/` é local (está em `.git/info/exclude`) e não vai para a `main`.
