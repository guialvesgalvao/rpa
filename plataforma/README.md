# Plataforma

API (Fastify 5) e site (Next.js 16) da plataforma RPA, com os contratos zod compartilhados com o app desktop. Projeto separado do app: `package.json`, lockfile, tooling e CI próprios (`.github/workflows/plataforma-ci.yml`). Em produção roda no Railway, construído a partir desta pasta.

## Estrutura

- `contratos/` (`@plataforma/contratos`) — esquemas zod das requisições e respostas e o tema de cada empresa (`empresas.ts`: `TEMAS`, `temaDaEmpresa`). Os imports internos usam a extensão `.ts` (`allowImportingTsExtensions`), porque o Turbopack do site não resolve `.js` para `.ts`.
- `web/` (`@plataforma/web`) — site Next.js (App Router). As cores da empresa vêm de `TEMAS` e são aplicadas por `[data-empresa]` (`src/tema.ts`, `src/app/globals.css`). Sessão e proxy da API em `src/servidor/` (`sessao.ts` funções puras, `api.ts` cliente da API, `acesso.ts` renovação), `src/proxy.ts` e `src/app/api/`.
- `api/` (`@plataforma/api`) — `src/app.ts` (`criarApp`), `src/servidor.ts` (`listen`) e `src/config.ts` (ambiente validado com zod).
- `api/src/db/` — esquema Drizzle (`esquema.ts`), conexão (`cliente.ts`) e migrador (`migrar.ts`). As migrações SQL versionadas ficam em `api/drizzle/`.
- `api/src/auth/senha.ts` (hash `scrypt`), `api/src/usuarios/servico.ts` (regras de usuários) e `api/src/cli/usuarios.ts` (CLI `usuarios`).
- `api/src/auth/` (`tokens.ts` JWT, `sessoes.ts` renovação rotativa, `limite.ts` tentativas de login), `api/src/plugins/autenticacao.ts` (`exigirUsuario`, `exigirEmpresa`, `exigirPerfil`) e `api/src/rotas/auth.ts`.

## Requisitos

- Node 24
- Docker (Postgres local)

## Comandos

Da raiz do repositório:

```bash
npm --prefix plataforma ci
npm --prefix plataforma run typecheck
npm --prefix plataforma run lint
npm --prefix plataforma run format:check
npm --prefix plataforma test                     # precisa do Postgres local (abaixo)
npm --prefix plataforma run build                # api/dist/{servidor,migrar}.mjs (contratos embutidos) e web/.next
npm --prefix plataforma -w @plataforma/api run dev    # tsx watch; lê plataforma/.env se existir
npm --prefix plataforma -w @plataforma/api start      # servidor compilado
npm --prefix plataforma run dev -w web                # site em http://localhost:3000
```

Saúde: `GET /v1/saude` (API) e `GET /api/saude` (site) → `{"status":"ok"}`.

## Autenticação

Contratos em `contratos/src/auth.ts`. Erros sempre como `{ "erro": { "codigo", "mensagem" } }`.

| Rota                    | Corpo                      | Resposta                                                                    |
| ----------------------- | -------------------------- | --------------------------------------------------------------------------- |
| `POST /v1/auth/entrar`  | `{ email, senha, origem }` | `{ acesso, renovacao, expiraEm, eu }`; 401 genérico; 403 `sem_empresa`      |
| `POST /v1/auth/renovar` | `{ renovacao }`            | `{ acesso, renovacao, expiraEm }`; 401 `sessao_invalida`                    |
| `POST /v1/auth/sair`    | `{ renovacao }`            | 204 (idempotente)                                                           |
| `GET /v1/eu`            | `Authorization: Bearer …`  | `{ id, nome, email, perfil, empresas }` lido do banco; 401 sem token válido |

- Acesso: JWT HS256 de 15 min (`sub`, `perfil`, `empresas`), assinado com `JWT_SEGREDO`. Um 401 `token_expirado` pede renovação.
- Renovação: token opaco de 32 bytes, guardado só como SHA-256 e trocado a cada uso. Reapresentar o token anterior até 60 s depois da troca é tratado como corrida (troca de novo); depois disso, como roubo (a sessão é revogada).
- Sessão `web` expira após 30 dias sem renovar; `desktop` só termina com `sair`, desativação do usuário ou revogação.
- Login: 5 tentativas por e-mail a cada 15 min (em memória; zera no deploy). A mensagem é sempre "E-mail ou senha inválidos.", inclusive quando bloqueado.
- Rotas protegidas: `preHandler: [app.autenticacao.exigirUsuario, app.autenticacao.exigirEmpresa('empresa')]` (slug do parâmetro no token) e `exigirPerfil('admin')`.

## Site: sessão e proxy da API

O navegador só fala com o site; o token nunca chega ao JavaScript da página.

- `POST /api/sessao/entrar` (formulário de `/entrar`): chama `POST /v1/auth/entrar` com `origem: 'web'`, grava os cookies e redireciona para `destino` (só caminhos internos) ou para `/{empresa}/artes` (a do cookie `rpa_empresa`, se o usuário tiver acesso, ou a primeira). Qualquer recusa volta para `/entrar?erro=1` com "E-mail ou senha inválidos.".
- `POST /api/sessao/sair`: revoga a sessão na API, apaga os cookies e vai para `/entrar`.
- Cookies `rpa_acesso` (15 min) e `rpa_renovacao` (30 dias): `httpOnly`, `SameSite=Lax`, `Path=/` e `Secure` em produção. O site não tem o `JWT_SEGREDO`: lê só o `exp` do acesso para decidir quando renovar (30 s antes do fim).
- `src/proxy.ts` guarda as páginas: sem sessão → `/entrar?destino=…`; acesso vencido → renova e grava os cookies novos; renovação recusada → apaga os cookies e vai para `/entrar`. O matcher deixa de fora `/`, `/api/**`, `/_next/**`, `/entrar` e arquivos estáticos.
- `/api/v1/**` repassa para a API em streaming (GET, POST, PATCH, DELETE) só os prefixos `/v1/eu`, `/v1/empresas/`, `/v1/cores` e `/v1/maquinas` (o resto é 404), com `Authorization` do cookie e o `Content-Type`. POST, PATCH e DELETE exigem `Origin` igual a `SITE_URL` (403). Sem sessão: 401 `nao_autenticado`; API fora do ar: 502 `api_indisponivel`.
- Os POST de entrar e sair também exigem `Origin` igual a `SITE_URL`.
- Páginas de empresa em `/{empresa}/…` (`src/app/[empresa]/layout.tsx`): o layout busca `/v1/eu` com o cookie de acesso; empresa fora das do usuário → 404; 401 da API (cookie forjado, que o `proxy.ts` não valida) → `/entrar`. Tema por `data-empresa`, logo de `public/empresas/` quando existe (senão só o nome) e menu lateral, que vira barra no topo em telas estreitas.
- `POST /api/sessao/empresa` (seletor, só para quem tem mais de uma empresa): exige `Origin` igual a `SITE_URL`, grava `rpa_empresa` (1 ano, `httpOnly`) e redireciona para `/{empresa}/artes`. Não confere o acesso: o layout dá 404 e o login ignora empresa alheia no cookie.

Local: suba o banco e a API (`npm --prefix plataforma -w @plataforma/api run dev`), crie um usuário pela CLI e rode `npm --prefix plataforma run dev -w web`; sem variáveis, o site usa a API em `http://localhost:3001` e se vê em `http://localhost:3000`.

## Banco local

```bash
docker compose -f plataforma/docker-compose.yml up -d --wait
```

Postgres 18 na porta `5433`, com os bancos `rpa` (desenvolvimento) e `rpa_teste` (testes). Usuário e senha `rpa` servem só para desenvolvimento.

Os testes recriam o `rpa_teste` do zero a cada execução (`api/tests/setup-global.ts`) e só aceitam bancos cujo nome termina em `_teste`.

## Migrações

O esquema fica em `api/src/db/esquema.ts`. Depois de mudar o esquema, gere a migração e confira o SQL:

```bash
npm --prefix plataforma -w @plataforma/api run db:gerar                         # drizzle/NNNN_*.sql
npm --prefix plataforma -w @plataforma/api run db:gerar -- --custom --name x    # SQL escrito à mão (ex.: dados de referência)
```

Para aplicar as migrações (precisa de `DATABASE_URL`):

```bash
npm --prefix plataforma -w @plataforma/api run db:migrar:dev   # tsx; lê plataforma/.env se existir
npm --prefix plataforma -w @plataforma/api run db:migrar       # dist/migrar.mjs (depois do build); uso em produção
```

Dados de referência (ex.: as empresas `aba` e `roma`) entram por migração SQL idempotente (`ON CONFLICT DO NOTHING`), não por seed.

## Usuários

Usuários só são gerenciados pela CLI `usuarios` (não há cadastro pela API). Ela grava no banco de `DATABASE_PUBLIC_URL` ou, se ausente, de `DATABASE_URL`, mostra o host de destino e pede confirmação (`s/N`) antes de gravar. A senha é digitada no terminal, sem eco e duas vezes (mínimo de 10 caracteres); nunca vai na linha de comando. Precisa de um terminal interativo.

```bash
npm --prefix plataforma -w @plataforma/api run usuarios -- criar --email ana@exemplo.com --nome "Ana" --perfil admin --empresas aba,roma
npm --prefix plataforma -w @plataforma/api run usuarios -- senha --email ana@exemplo.com
npm --prefix plataforma -w @plataforma/api run usuarios -- empresas --email ana@exemplo.com --empresas roma
npm --prefix plataforma -w @plataforma/api run usuarios -- desativar --email ana@exemplo.com   # revoga as sessões
npm --prefix plataforma -w @plataforma/api run usuarios -- listar
```

Perfis: `admin` ou `arte_finalista`. Empresas: slugs separados por vírgula (ao menos uma). O e-mail é gravado em minúsculas. As senhas ficam como hash `scrypt` (parâmetros da OWASP); `senha` não revoga as sessões abertas.

### Primeiro admin

Local: suba o banco, aplique as migrações e crie o usuário (com `plataforma/.env` copiado do `.env.example`, ou `DATABASE_URL` no ambiente):

```bash
docker compose -f plataforma/docker-compose.yml up -d --wait
npm --prefix plataforma -w @plataforma/api run db:migrar:dev
npm --prefix plataforma -w @plataforma/api run usuarios -- criar --email voce@exemplo.com --nome "Seu nome" --perfil admin --empresas aba,roma
```

Produção: o `railway run` injeta as variáveis do serviço Postgres (incluindo `DATABASE_PUBLIC_URL`, acessível de fora do Railway). Confira o host mostrado antes de confirmar:

```bash
railway run --service Postgres -- npm --prefix plataforma -w @plataforma/api run usuarios -- criar --email voce@exemplo.com --nome "Seu nome" --perfil admin --empresas aba,roma
```

## Ambiente

| Variável             | Padrão                                        | Uso                                             |
| -------------------- | --------------------------------------------- | ----------------------------------------------- |
| `PORT`               | `3001`                                        | porta HTTP                                      |
| `HOST`               | `::`                                          | interface (todas, IPv4 e IPv6)                  |
| `DATABASE_URL`       | —                                             | banco da API e do `db:migrar` (obrigatória)     |
| `JWT_SEGREDO`        | —                                             | chave do JWT, ao menos 32 bytes (obrigatória)   |
| `DATABASE_URL_TESTE` | `postgres://rpa:rpa@localhost:5433/rpa_teste` | banco dos testes (precisa terminar em `_teste`) |

Site (`web/`), obrigatórias em produção:

| Variável          | Padrão fora de produção | Uso                                                             |
| ----------------- | ----------------------- | --------------------------------------------------------------- |
| `API_URL_INTERNA` | `http://localhost:3001` | endereço da API visto pelo servidor do site (rede privada)      |
| `SITE_URL`        | `http://localhost:3000` | endereço público do site: base dos redirecionamentos e `Origin` |

Modelo em `.env.example`. Gere o `JWT_SEGREDO` com `node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"`; trocá-lo invalida os tokens de acesso emitidos (as sessões continuam e renovam). Os testes não leem o ambiente: injetam um segredo fictício em `criarApp`. Em produção, as variáveis ficam no painel do Railway; scripts locais contra produção recebem as credenciais via `railway run`. Nunca coloque credenciais no repositório.
