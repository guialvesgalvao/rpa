# ADR 0002 — API Fastify isolada e site Next.js como BFF

- **Status:** aceito
- **Data:** 2026-10-28

## Contexto

Dois clientes consomem os mesmos dados e regras:

- o site, usado pelo arte finalista na nuvem (login, seletor de empresa, Artes);
- o app desktop (Electron), em que a API é chamada pelo processo main, porque a CSP bloqueia `fetch` remoto no renderer.

Os uploads de arte chegam a 25 MB. No Next.js, Server Actions têm limite de 1 MB, e o corpo que passa pelo `proxy` é bufferizado até 10 MB e cortado sem erro.

## Decisão

1. Pasta `plataforma/` com npm workspaces próprios:
   - `api`: Fastify 5, a única dona das regras, do banco e do segredo do JWT;
   - `contratos`: esquemas zod compartilhados, com o `zod` na mesma versão da raiz, para o app importar os contratos por caminho relativo;
   - `web`: Next.js (App Router), que entra com o site.
2. O site é um BFF: guarda a sessão em cookies `httpOnly` e repassa as chamadas para a API por um proxy autenticado (`/api/v1/[...caminho]`), em streaming e com lista de prefixos permitidos. O navegador nunca chama a API direto.
3. API com rotas versionadas em `/v1`, erros no formato `{ erro: { codigo, mensagem } }` e sem CORS.
4. Tooling autossuficiente em `plataforma/` (o Railway constrói só a partir dela); o lint e o prettier da raiz a ignoram. CI próprio (`plataforma-ci.yml`, ubuntu + `postgres:18`); o CI da raiz ignora `plataforma/**`, menos `plataforma/contratos/**`.
5. A plataforma não usa as tags `v*`, que são do app. O deploy é automático por caminho no Railway. O serviço `api` (confirmado no primeiro deploy, 2026-10-28):
   - Root Directory `/plataforma`, Build `npm run build`, Start `node api/dist/servidor.mjs`;
   - Healthcheck `/v1/saude` e 1 réplica.

## Alternativas consideradas

| Alternativa                                                                 | Por que não                                                                                                                                                                                                                                                             |
| --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Next.js fullstack (API dentro do site, em Route Handlers ou Server Actions) | O app desktop passaria a depender do deploy e das rotas do site; os limites de corpo do Next (1 MB nas Server Actions, 10 MB pelo `proxy`) pedem cuidado com uploads de 25 MB; e a API isolada é testada sozinha (`app.inject` contra Postgres real), sem subir o site. |

## Consequências

- Dois serviços no Railway (API e site), com um salto a mais nas chamadas do site.
- O site precisa renovar a sessão e repassar o corpo sem bufferizar; o matcher do `proxy` exclui `/api/**`.
- Os contratos são compartilhados por API, site e app: mudar um esquema afeta os três, e o CI da raiz roda quando `plataforma/contratos/**` muda.
- O segredo do JWT fica só na API; o site só decodifica o token (`decodeJwt`) para decidir quando renovar.

## Gatilho de revisão

- Algum cliente precisar chamar a API direto do navegador (exigiria CORS e outro transporte de token).
