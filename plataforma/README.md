# Plataforma

API da plataforma RPA (Fastify 5) e contratos zod compartilhados com o site e o app desktop. Projeto separado do app: `package.json`, lockfile, tooling e CI próprios (`.github/workflows/plataforma-ci.yml`). Em produção roda no Railway, construído a partir desta pasta.

## Estrutura

- `contratos/` (`@plataforma/contratos`) — esquemas zod das requisições e respostas. Os imports internos usam a extensão `.js`.
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
npm --prefix plataforma run build                # api/dist/{servidor,migrar}.mjs (contratos embutidos)
npm --prefix plataforma -w @plataforma/api run dev    # tsx watch; lê plataforma/.env se existir
npm --prefix plataforma -w @plataforma/api start      # servidor compilado
```

Saúde: `GET /v1/saude` → `{"status":"ok"}`.

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

Modelo em `.env.example`. Gere o `JWT_SEGREDO` com `node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"`; trocá-lo invalida os tokens de acesso emitidos (as sessões continuam e renovam). Os testes não leem o ambiente: injetam um segredo fictício em `criarApp`. Em produção, as variáveis ficam no painel do Railway; scripts locais contra produção recebem as credenciais via `railway run`. Nunca coloque credenciais no repositório.
