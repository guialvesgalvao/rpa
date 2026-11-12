# Plataforma

API (Fastify 5) e site (Next.js 16) da plataforma RPA, com os contratos zod compartilhados com o app desktop. Projeto separado do app: `package.json`, lockfile, tooling e CI próprios (`.github/workflows/plataforma-ci.yml`). Em produção roda no Railway, construído a partir desta pasta.

## Estrutura

- `contratos/` (`@plataforma/contratos`) — esquemas zod das requisições e respostas e o tema de cada empresa (`empresas.ts`: `TEMAS`, `temaDaEmpresa`). Os imports internos usam a extensão `.ts` (`allowImportingTsExtensions`), porque o Turbopack do site não resolve `.js` para `.ts`.
- `web/` (`@plataforma/web`) — site Next.js (App Router). As cores da empresa vêm de `TEMAS` e são aplicadas por `[data-empresa]` (`src/tema.ts`, `src/app/globals.css`). Sessão e proxy da API em `src/servidor/` (`sessao.ts` funções puras, `api.ts` cliente da API, `acesso.ts` renovação), `src/proxy.ts` e `src/app/api/`.
- `api/` (`@plataforma/api`) — `src/app.ts` (`criarApp`), `src/servidor.ts` (`listen`) e `src/config.ts` (ambiente validado com zod).
- `api/src/db/` — esquema Drizzle (`esquema.ts`), conexão (`cliente.ts`) e migrador (`migrar.ts`). As migrações SQL versionadas ficam em `api/drizzle/`.
- `api/src/auth/senha.ts` (hash `scrypt`), `api/src/usuarios/servico.ts` (regras de usuários) e `api/src/cli/usuarios.ts` (CLI `usuarios`). `api/src/cli/semear-dev.ts` popula o banco local com dados fictícios.
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

Suíte E2E local (raiz: `npm run e2e`, ADR 0010): usa dois scripts da API, chamados pela própria suíte.

- `e2e:banco -- preparar`: cria o banco `rpa_e2e` se faltar, apaga tudo, migra e roda o `semear` mais os usuários da suíte (`desativavel.e2e@exemplo.com` e `troca.e2e@exemplo.com`). `e2e:banco -- desativar <email>` desativa um usuário. Lê só `DATABASE_URL` e recusa host não local ou banco que não termine em `_e2e`.
- `e2e:servidor`: a API sem `--env-file` (o `.env` local não vaza Bling nem bucket); a suíte passa as variáveis.

O site da suíte roda com `NEXT_DIST_DIR=.next-e2e` (`distDir` em `web/next.config.ts`), na porta 3100, ao lado do `next dev` de sempre.

## Autenticação

Contratos em `contratos/src/auth.ts`. Erros sempre como `{ "erro": { "codigo", "mensagem" } }`.

| Rota                    | Corpo                      | Resposta                                                                                                               |
| ----------------------- | -------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `POST /v1/auth/entrar`  | `{ email, senha, origem }` | `{ acesso, renovacao, expiraEm, eu }`; 401 genérico; 403 `sem_empresa`                                                 |
| `POST /v1/auth/renovar` | `{ renovacao }`            | `{ acesso, renovacao, expiraEm }`; 401 `sessao_invalida`                                                               |
| `POST /v1/auth/sair`    | `{ renovacao }`            | 204 (idempotente)                                                                                                      |
| `GET /v1/eu`            | `Authorization: Bearer …`  | `{ id, nome, email, area, perfil, empresas }` lido do banco, com as `permissoes` de cada empresa; 401 sem token válido |

- Acesso: JWT HS256 de 15 min (`sub`, `perfil`, `empresas`), assinado com `JWT_SEGREDO`. Um 401 `token_expirado` pede renovação.
- Renovação: token opaco de 32 bytes, guardado só como SHA-256 e trocado a cada uso. Reapresentar o token anterior até 60 s depois da troca é tratado como corrida (troca de novo); depois disso, como roubo (a sessão é revogada).
- Sessão `web` expira após 30 dias sem renovar; `desktop` só termina com `sair`, desativação do usuário ou revogação.
- Login: 5 tentativas por e-mail a cada 15 min (em memória; zera no deploy). A mensagem é sempre "E-mail ou senha inválidos.", inclusive quando bloqueado.
- Rotas protegidas: `preHandler: [app.autenticacao.exigirUsuario, app.autenticacao.exigirEmpresa('empresa'), app.autenticacao.exigirPermissao('artes')]`. `exigirUsuario` lê do banco, a cada requisição, se o usuário está ativo e não excluído e as permissões dele por empresa; `exigirEmpresa` confere o slug do parâmetro nas empresas do token; `exigirPermissao(chave)` exige a permissão na empresa da rota (403 `permissao_proibida`), e `exigirPermissaoEmAlgumaEmpresa(chave)` serve às rotas sem empresa.
- Permissões (ADR 0011): catálogo em `contratos/src/permissoes.ts` (`artes`, `artes.adicionar`, `artes.editar`, `artes.acompanhar`, `faturas`, `ops`, `usuarios`, `usuarios.permissoes`, `usuarios.editar`, `compras`, `compras.pedir`, `compras.acompanhar`), gravadas por empresa em `usuario_empresas.permissoes` (migração `0017`, que converteu os perfis: `admin` → todas; `arte_finalista` → `artes` + `artes.adicionar`). Uma subpermissão só vale com o módulo. O `perfil` da resposta e do token é derivado (`perfilLegado`) só para o app antigo; nada decide acesso por ele. Todo módulo novo da aba lateral nasce com uma permissão no catálogo.

## Site: sessão e proxy da API

O navegador só fala com o site; o token nunca chega ao JavaScript da página.

- `POST /api/sessao/entrar` (formulário de `/entrar`): chama `POST /v1/auth/entrar` com `origem: 'web'`, grava os cookies e redireciona para `destino` (só caminhos internos) ou para `/{empresa}/artes` (a do cookie `rpa_empresa`, se o usuário tiver acesso, ou a primeira). Qualquer recusa volta para `/entrar?erro=1` com "E-mail ou senha inválidos.".
- `POST /api/sessao/sair`: revoga a sessão na API, apaga os cookies e vai para `/entrar`.
- `POST /api/sessao/senha` (formulários de `/trocar-senha` e da Minha conta): chama `POST /v1/eu/senha` com o token de renovação do cookie, para a sessão deste navegador continuar. Do primeiro acesso, volta para a empresa ou para `/trocar-senha?erro=<código>`; com `retorno=conta` e uma empresa válida, volta para `/{empresa}/conta?ok=1` ou `?erro=<código>` (destino fechado, nunca vindo da URL).
- Cookies `rpa_acesso` (15 min) e `rpa_renovacao` (30 dias): `httpOnly`, `SameSite=Lax`, `Path=/` e `Secure` em produção. O site não tem o `JWT_SEGREDO`: lê só o `exp` do acesso para decidir quando renovar (30 s antes do fim).
- `src/proxy.ts` guarda as páginas: sem sessão → `/entrar?destino=…`; acesso vencido → renova e grava os cookies novos; renovação recusada → apaga os cookies e vai para `/entrar`. O matcher deixa de fora `/`, `/api/**`, `/_next/**`, `/entrar` e arquivos estáticos.
- `/api/v1/**` repassa para a API em streaming (GET, POST, PATCH, DELETE) só os prefixos `/v1/eu`, `/v1/empresas/`, `/v1/cores`, `/v1/maquinas` e `/v1/usuarios` (o resto é 404), com `Authorization` do cookie e o `Content-Type`. POST, PATCH e DELETE exigem `Origin` igual a `SITE_URL` (403). Sem sessão: 401 `nao_autenticado`; API fora do ar: 502 `api_indisponivel`.
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

O painel de usuários (site: menu **Usuários**; app: aba **Usuários**) trabalha por empresa, com as permissões do ADR 0011: `usuarios` vê a lista; `usuarios.editar` cria, edita (nome, e-mail, área, empresas) e exclui; `usuarios.permissoes` marca as permissões. Quem cria só escolhe empresas em que tem `usuarios.editar`, e só manda permissões das empresas em que tem `usuarios.permissoes` (sem ela, o usuário nasce sem permissões). Editar os dados, redefinir a senha ou excluir um usuário de mais de uma empresa exige `usuarios.editar` em todas elas. A senha inicial é definida por quem cria, e o usuário nasce com `deve_trocar_senha` (migração `0010`): o login e `GET /v1/eu` devolvem `deveTrocarSenha: true`, e o site e o app levam à tela de troca antes de qualquer outra (a API não bloqueia as outras rotas). Área (`usuarios.area`, migração `0017`): `arte_finalista`, `producao`, `administracao` ou `direcao`, só informativa e nula nos usuários antigos.

| Rota                                                  | Resposta                                                                                                                                                                                                                                                                          |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /v1/empresas/:empresa/usuarios`                  | `usuarios`: usuários não excluídos da empresa, com área, `ativo` e as permissões em cada empresa                                                                                                                                                                                  |
| `POST /v1/empresas/:empresa/usuarios`                 | `usuarios.editar`: `{ nome, email, area, empresas, senha, permissoes? }` → `201`; empresa sem `usuarios.editar`: `403 empresa_proibida`; permissões numa empresa sem `usuarios.permissoes`: `403 permissao_proibida`; e-mail repetido (inclusive de excluído): `409 email_em_uso` |
| `PATCH /v1/empresas/:empresa/usuarios/:id`            | `usuarios.editar` em todas as empresas do alvo: `{ nome?, email?, area?, empresas? }`                                                                                                                                                                                             |
| `PATCH /v1/empresas/:empresa/usuarios/:id/permissoes` | `usuarios.permissoes`: `{ permissoes }` do alvo nesta empresa, normalizadas; tirar a própria `usuarios.permissoes`: `409 propria_permissao`                                                                                                                                       |
| `POST /v1/empresas/:empresa/usuarios/:id/senha`       | `usuarios.editar` em todas as empresas do alvo: `{ novaSenha }` (mínimo de 10) → `204`; senha temporária: liga `deve_trocar_senha` e não revoga as sessões (ADR 0013); a si mesmo: `409 proprio_usuario` |
| `DELETE /v1/empresas/:empresa/usuarios/:id`           | `usuarios.editar` em todas as empresas do alvo: `204`; soft delete (`excluido_em`), revoga as sessões e corta o acesso na hora; o e-mail continua bloqueado; a si mesmo: `409 proprio_usuario`                                                                                    |
| `GET`/`POST /v1/usuarios`                             | só para o app antigo: `GET` com `usuarios` em alguma empresa; `POST` com `perfil` (convertido em permissões), exigindo `usuarios.editar` e `usuarios.permissoes`                                                                                                                  |
| `POST /v1/eu/senha`                                   | qualquer usuário (primeiro acesso e Minha conta): `{ senhaAtual, novaSenha, renovacao? }` → `204`; desliga o pedido de troca e revoga as outras sessões (a de `renovacao` continua); senha atual errada ou nova igual: `400`; 5 tentativas em 15 min: `429`                                                       |

Toda empresa mantém ao menos um usuário ativo com `usuarios.permissoes`: a mudança ou exclusão que a deixaria sem ninguém responde `409 ultimo_administrador`. Usuário de outra empresa, excluído ou inexistente: `404 usuario_nao_encontrado`.

Desativar continua só na CLI `usuarios`, que também troca a senha de outro usuário sem pedir a troca no login (usuários criados por ela não precisam trocar a senha). Pela tela, a redefinição é temporária (ADR 0013). Qualquer usuário troca a própria senha na **Minha conta** (o nome no rodapé do menu, no site e no app). Ela grava no banco de `DATABASE_PUBLIC_URL` ou, se ausente, de `DATABASE_URL`, mostra o host de destino e pede confirmação (`s/N`) antes de gravar. A senha é digitada no terminal, sem eco e duas vezes (mínimo de 10 caracteres); nunca vai na linha de comando. Precisa de um terminal interativo.

```bash
npm --prefix plataforma -w @plataforma/api run usuarios -- criar --email ana@exemplo.com --nome "Ana" --perfil admin --empresas aba,roma
npm --prefix plataforma -w @plataforma/api run usuarios -- senha --email ana@exemplo.com
npm --prefix plataforma -w @plataforma/api run usuarios -- empresas --email ana@exemplo.com --empresas roma
npm --prefix plataforma -w @plataforma/api run usuarios -- desativar --email ana@exemplo.com   # revoga as sessões
npm --prefix plataforma -w @plataforma/api run usuarios -- listar
```

`--perfil` (`admin` ou `arte_finalista`) é um atalho que vira as permissões equivalentes em todas as empresas do usuário (`PERMISSOES_DO_PERFIL`). Empresas: slugs separados por vírgula (ao menos uma). O e-mail é gravado em minúsculas. As senhas ficam como hash `scrypt` (parâmetros da OWASP); `senha` não revoga as sessões abertas.

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

## Artes: clientes, produtos e cadastro manual

O que são catálogo, cliente e arte, e como se relacionam: ver [Catálogo, clientes e artes](../README.md#catálogo-clientes-e-artes).

Clientes e produtos **não têm cadastro pela API**: entram por INSERT direto no banco (o `semear-dev` só serve para desenvolvimento local). As regras de formato ficam no próprio banco; o INSERT falha se algo estiver errado.

**CNPJ com 14 dígitos, sem pontuação** (`11222333000181`, não `11.222.333/0001-81`), com os dígitos verificadores corretos (`cnpj_valido`), único por empresa. `nome_exibicao` (fantasia ou, se vazia, razão social) e `busca` (sem acento, minúsculas) são colunas geradas: não entram no INSERT.

```sql
-- empresa_id: SELECT id FROM empresas WHERE slug = 'aba';
INSERT INTO clientes (empresa_id, razao_social, nome_fantasia, cnpj)
VALUES ('<empresa_id>', 'Padaria Exemplo Ltda', 'Padaria Exemplo', '11222333000181');
-- sem nome fantasia: omita a coluna (ou NULL); texto vazio é recusado

INSERT INTO produtos (empresa_id, nome)
VALUES ('<empresa_id>', 'Caixa de Pizza');
-- o nome é único por empresa, sem diferenciar maiúsculas nem acentos
```

Cores e máquinas são globais (iguais nas duas empresas). Máquinas (`Favorit`, `Rekord`, `Ultra`) vêm de migração. Cores começam com `4x0` e `4x4` (migração) e as novas são criadas no cadastro da arte (`POST /v1/cores`, com `artes.adicionar` em alguma empresa; nome único sem diferenciar maiúsculas nem acentos). A lista de cores fica 1 h em cache no site e no app (ADR 0009). A arte nunca fica sem arquivo (PDF ou imagem), e o produto precisa ser da mesma empresa do cliente.

Dados fictícios para desenvolvimento (recusa qualquer banco que não seja `localhost` ou `127.0.0.1`; lê só `DATABASE_URL`; é idempotente):

```bash
npm --prefix plataforma -w @plataforma/api run db:migrar:dev
npm --prefix plataforma -w @plataforma/api run semear-dev
```

Cria os usuários `admin.dev@exemplo.com` e `finalista.dev@exemplo.com` (senha `senha-dev-1234`, nas duas empresas), 60 clientes e 8 produtos por empresa, algumas artes com arquivos sintéticos e três insumos fictícios `TPP000x` na Roma (Compras). O admin recebe todas as permissões e a finalista, `artes` + `artes.adicionar`.

## Arquivos no bucket

O conteúdo dos arquivos (PDF e imagem das artes) fica num bucket S3 quando as cinco variáveis `ARQUIVOS_S3_*` estão definidas; sem elas, continua no Postgres (`bytea`). A tabela `arquivos` guarda sempre os metadados e, em cada linha, ou o `conteudo` ou a `chave_objeto` (migração `0011`; um CHECK exige exatamente um). A API é a porta de entrada: upload e download passam por ela (o bucket é privado, sem URL pré-assinada). O objeto é gravado antes da transação e apagado se ela falhar; ao trocar ou remover um arquivo, a linha sai primeiro e o objeto depois (falha vira só log com a chave). Rotas de leitura: `GET /v1/empresas/:empresa/artes/:id/imagem` e `GET /v1/empresas/:empresa/artes/:id/pdf` (download, `Content-Disposition: attachment`).

Local: o `docker-compose.yml` sobe um S3 de teste (S3Mock, porta `9090`, buckets `rpa-arquivos` e `rpa-arquivos-teste`, aceita qualquer credencial). Os testes usam o `rpa-arquivos-teste` (`ARQUIVOS_S3_TESTE_URL`, padrão `http://localhost:9090`). Para a API local usar o bucket, veja o exemplo no `.env.example`.

### Migração dos arquivos atuais para o bucket

`arquivos:migrar` copia, em lotes, cada arquivo ainda em `bytea` para o bucket, lê de volta e confere tamanho e sha256, e só então grava a chave e zera o conteúdo. É idempotente (rodar de novo não faz nada) e uma falha deixa a linha como estava. O log mostra só contagens; termina com código 1 se houver falha.

Produção, nesta ordem (executado pelo usuário):

1. Deploy da API com a migração `0011` e as variáveis `ARQUIVOS_S3_*` referenciadas no serviço `api` (artes novas já vão para o bucket).
2. Com as variáveis do banco e do bucket injetadas pelo `railway run` (nunca coladas em arquivo ou no chat):

   ```bash
   railway run --service api -- npm --prefix plataforma -w @plataforma/api run arquivos:migrar
   ```

   O script usa `DATABASE_PUBLIC_URL` se existir (senão `DATABASE_URL`); conecte o serviço do Postgres se a URL pública não vier no `api`.

3. Confira que terminou com `ainda no banco: 0`; se houver falhas, rode de novo.

## Tarefas de desenvolvimento de arte

Registram o desenvolvimento de uma arte de um produto do catálogo para um cliente (uso no `README.md` da raiz). Comentários podem ter até 5 anexos (PDF ou imagem, com os limites e a detecção de tipo das artes; migração `0012`), gravados pelo armazém de arquivos. A tarefa tem `origem` (`manual` ou `bling_pedido`, com `pedidoNumero`) e cada empresa pode ter um responsável automático (migração `0013`). Tabelas `tarefas_arte`, `tarefas_arte_comentarios` e `tarefas_arte_historico` (migração `0009`); a regra "concluída exige arte" é um CHECK no banco, e a arte da tarefa não pode ser removida (FK `RESTRICT`, a API responde 409 `arte_em_tarefa`). As rotas exigem `artes`; criar e concluir, `artes.adicionar`. Quem tem `artes.acompanhar` alcança todas as tarefas da empresa; os demais, só as de que são responsáveis (as outras respondem 404).

| Rota                                                                  | Resposta                                                                                                                                                                             |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `POST /v1/empresas/:empresa/clientes/:id/produtos/:produtoId/tarefas` | `201` com a tarefa (`nao_iniciada`, responsável = quem criou) e o primeiro evento no histórico                                                                                       |
| `GET /v1/empresas/:empresa/tarefas?escopo&status`                     | tarefas, mais recentes primeiro; `escopo`: `minhas` (padrão), `andamento` (não terminadas) ou `todas`; o arte finalista sempre recebe só as próprias                                 |
| `GET /v1/empresas/:empresa/tarefas/:id`                               | a tarefa com os comentários                                                                                                                                                          |
| `PATCH /v1/empresas/:empresa/tarefas/:id/status`                      | `{ status }`: muda e grava o histórico (o mesmo status não gera evento); `concluida` sem arte: 409 `tarefa_sem_arte`                                                                 |
| `POST /v1/empresas/:empresa/tarefas/:id/concluir`                     | multipart com os campos do cadastro de arte (cliente e produto são os da tarefa): cadastra a arte e conclui numa transação; tarefa que já tem arte: 409 `tarefa_com_arte`            |
| `POST /v1/empresas/:empresa/tarefas/:id/comentarios`                  | JSON `{ texto }` (1 a 2000 caracteres, aparado) ou multipart (`texto` opcional + até 5 `anexos`): `201` com o comentário; 6 anexos: `400`; tipo trocado: `415`; grande: `413`        |
| `GET /v1/empresas/:empresa/tarefas/:id/comentarios/:c/anexos/:a`      | download do anexo (`Content-Disposition: attachment`), com o mesmo alcance da tarefa                                                                                                 |
| `GET /v1/empresas/:empresa/tarefas/contagem`                          | não terminadas por status (`nao_iniciada`, `em_desenvolvimento`, `aguardando_cliente`): as próprias, ou todas com `artes.acompanhar`                                                 |
| `GET`/`PUT /v1/empresas/:empresa/tarefas/responsavel-automatico`      | `artes.acompanhar`: o responsável das tarefas automáticas e os elegíveis (ativos com `artes.adicionar` e sem `artes.acompanhar`); `PUT { responsavelId \| null }`, inelegível: `400` |
| `GET /v1/empresas/:empresa/tarefas/:id/historico`                     | mudanças de status, da criação à mais recente (anterior, novo, autor, data/hora)                                                                                                     |

## Compras: pedidos de insumos

Pedidos de compra (ADR 0012), só nas empresas de `EMPRESAS_SINCRONIZACAO_BLING` (`empresaTemCompras`, hoje só `roma`; nas outras, `404 compras_indisponivel`). Contratos em `contratos/src/compras.ts`. Insumo é o produto ativo da empresa com `codigo` começando por `TPP` (vem da sincronização). Tabelas `compras_pedidos` e `compras_historico` (migração `0018`), `compras_comentarios` e `compras_comentario_anexos` (migração `0019`). Cada mudança grava o evento do histórico na mesma transação (`criacao`, `status`, `responsavel`, `edicao`, com o antes/depois e os nomes do momento); o mesmo valor não gera evento. Quem tem `compras.acompanhar` alcança todos os pedidos da empresa; os demais, só os que criaram (os outros respondem `404 pedido_nao_encontrado`).

| Rota                                                                     | Resposta                                                                                                                                                                                                          |
| ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /v1/empresas/:empresa/compras/insumos`                              | `compras.pedir`: os insumos (`{ id, codigo, nome }`), por código                                                                                                                                                  |
| `POST /v1/empresas/:empresa/compras/pedidos`                             | `compras.pedir`: `{ insumoId, quantidade, observacao? }` (quantidade > 0, até 3 decimais; observação até 500) → `201`, Aberta, com a área do criador copiada; insumo que não é `TPP` ativo: `400 insumo_invalido` |
| `GET /v1/empresas/:empresa/compras/pedidos?escopo&status`                | `compras`: mais recentes primeiro; `escopo`: `meus` (padrão: criados ou assumidos), `abertos` (Aberta e Em andamento) ou `todos`                                                                                  |
| `GET /v1/empresas/:empresa/compras/pedidos/:id`                          | `compras`: o pedido com os comentários                                                                                                                                                                            |
| `PATCH /v1/empresas/:empresa/compras/pedidos/:id`                        | `compras`: `{ insumoId?, quantidade?, observacao? }`, pelo criador com `compras.pedir` ou por quem acompanha (senão `403 permissao_proibida`); concluído ou cancelado: `409 pedido_encerrado`                     |
| `POST /v1/empresas/:empresa/compras/pedidos/:id/assumir`                 | `compras.acompanhar`: vira o responsável e passa para Em andamento (dois eventos); terminado: `409 pedido_encerrado`                                                                                              |
| `PATCH /v1/empresas/:empresa/compras/pedidos/:id/status`                 | `compras`: `{ status }` (`aberta`, `em_andamento`, `concluida`, `cancelada`); qualquer um para quem acompanha; o criador só cancela o próprio enquanto Aberta                                                     |
| `GET /v1/empresas/:empresa/compras/pedidos/:id/historico`                | `compras`: os eventos, da criação ao mais recente                                                                                                                                                                 |
| `POST /v1/empresas/:empresa/compras/pedidos/:id/comentarios`             | `compras`: JSON `{ texto }` ou multipart (`texto` opcional + até 5 `anexos`), com os limites das tarefas de arte → `201`                                                                                          |
| `GET /v1/empresas/:empresa/compras/pedidos/:id/comentarios/:c/anexos/:a` | `compras`: download do anexo, com o alcance do pedido                                                                                                                                                             |

## Sincronização com o Bling (API v3)

Leitura de **produtos ativos** e **contatos ativos do tipo Cliente** (com o detalhe de cada um) pela API v3 do Bling, só com GET, gravada nas tabelas `clientes` e `produtos` (as mesmas das artes). Só quem tem `ops` nas empresas em `EMPRESAS_SINCRONIZACAO_BLING` (`contratos/src/bling.ts`, hoje só `roma`) pode usar; o app chama pelo botão "Sincronizar dados" em Configurações.

| Rota                                                       | Resposta                                                                                                                                                |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /v1/empresas/:empresa/bling/conexao`                 | `{ urlAutorizacao }` para abrir no navegador                                                                                                            |
| `POST /v1/empresas/:empresa/bling/sincronizacao`           | `202` com o estado do job (inicia um, ou devolve o que já está rodando)                                                                                 |
| `GET /v1/empresas/:empresa/bling/sincronizacao`            | estado: `ociosa`, `em_andamento` (etapa e progresso), `concluida` (resumo), `falhou`                                                                    |
| `GET /v1/empresas/:empresa/bling/sincronizacao/automatica` | status da automática: ligada, intervalo, último resultado, próxima completa e a conta conectada (não chama o Bling)                                     |
| `GET /v1/bling/oauth/retorno` (pública, sem log)           | página "Bling conectado: <nome da conta>" ou a falha (conta errada, app sem o escopo de dados da empresa); é o link de redirecionamento do app do Bling |

Erros: `503 bling_nao_configurado` (sem as variáveis), `409 bling_nao_conectado` (autorizar de novo), `502 bling_indisponivel`, `403 sincronizacao_indisponivel` (empresa fora da lista).

Para conectar (local):

1. Preencha `BLING_CLIENT_ID`, `BLING_CLIENT_SECRET`, `BLING_REDIRECT_URI` e `BLING_CHAVE_TOKENS` no `plataforma/.env` (modelo e comando da chave no `.env.example`). As quatro vão juntas: com só algumas, a API não sobe.
2. Aplique as migrações (`db:migrar:dev`; a `0007` cria `bling_conexoes` e a `0008`, o `id_bling` e a marca de inativo) e suba a API (`npm --prefix plataforma -w @plataforma/api run dev`).
3. No app, "Sincronizar dados" sem conexão abre a autorização do Bling no navegador. Depois de autorizar, o Bling volta para `BLING_REDIRECT_URI` e a conexão fica gravada, com os tokens cifrados (AES-256-GCM). Clique em "Sincronizar dados" de novo.

**Conta conectada:** no retorno, antes de gravar, a API lê a conta autorizada (`GET /empresas/me/dados-basicos`, com o token recém-emitido) e recusa, sem gravar nada, quando o CNPJ dela é diferente do `BLING_<SLUG>_CNPJ` da empresa (hoje só `BLING_ROMA_CNPJ`; opcional) ou já está ligado à conexão de outra empresa. A página pede para sair do Bling e entrar com a conta certa (de preferência numa janela anônima). Por isso o app do Bling precisa do **escopo de dados da empresa**: sem ele, o Bling responde `403` e a página explica o que falta. O CNPJ e o nome da conta ficam em `bling_conexoes` (`conta_cnpj`, só dígitos, e `conta_nome`; migração `0014`; o refresh não muda a conta) e saem em `conta` no status da automática; o app mostra "Conectado a: <nome> (<CNPJ>)" nas Configurações, ou "Conta do Bling não identificada" sem conexão ou com uma conexão anterior à `0014`. CNPJ e tokens nunca vão para o log.

Como a gravação funciona (tudo numa transação; uma falha no meio desfaz tudo):

- **Vínculo:** `clientes.id_bling` e `produtos.id_bling` guardam o id do registro no Bling (único por empresa). Um cadastro manual sem vínculo é **adotado** pelo CNPJ (cliente) ou pelo `codigo` (produto), mantendo o `id` e as artes; produto sem `codigo` só casa pelo id do Bling.
- **Fonte da verdade:** o Bling manda nos campos sincronizados (`razao_social` = nome, `nome_fantasia` = fantasia, `cnpj`, `nome`, `codigo`); uma edição manual nesses campos é sobrescrita na sincronização seguinte.
- **Ficam de fora**, com um aviso agregado por motivo no resumo (nunca com nome nem documento): clientes sem CNPJ válido (pessoa física, sem documento ou dígitos errados; validado pela função `cnpj_valido` do banco), registros sem nome, CNPJ ou `codigo` repetido (fica o vínculo existente ou, sem vínculo, o primeiro lido; uma linha já ligada que mudaria para um valor em uso fica como estava) e produtos com nome repetido (a unicidade sem acento nem caixa de `produtos`).
- **Inativos:** na sincronização completa, uma linha com `id_bling` que não veio do Bling (inativada ou excluída lá) recebe `inativo_no_bling_em`; ela some da busca de clientes e da lista de produtos, mas continua no banco, com as artes, e as rotas por id ainda a encontram. Se voltar a ficar ativa no Bling, a marca sai.
- **Resumo:** `produtos` e `clientes` contam as linhas gravadas (inseridas ou que mudaram), não as lidas.
- **Último resultado:** cada sincronização (botão ou agendador) grava em `bling_sincronizacoes` o tipo (`completa`/`incremental`), a origem (`botao`/`agendador`), a situação (`concluida`, `falhou`, `nao_conectado`), as contagens e os avisos. Só um sucesso avança a janela do próximo incremental (o início do ciclo) e, na completa, a `ultima_completa_em`; uma falha não avança nada. O status sai em `GET …/bling/sincronizacao/automatica`, com `proximaCompletaEm = ultimaCompletaEm + BLING_COMPLETA_DIAS` (nula com a automática desligada ou antes da primeira completa).

**O banco local passa a ter dados reais de clientes (nomes, CNPJ)**: nada disso vai para chat, log nem fixture. Trocar `BLING_CHAVE_TOKENS` invalida a conexão gravada (é preciso autorizar de novo).

**Produção** (desde 2026-11-09): as `BLING_*` ficam no serviço da API no Railway, com `BLING_ROMA_CNPJ` preenchido e a sincronização automática ligada; a Roma está conectada à conta do Bling dela. Sem as quatro `BLING_*`, as rotas respondem `503 bling_nao_configurado`.

### Sincronização automática

Com `BLING_SINCRONIZACAO_AUTOMATICA=true` (exige as quatro `BLING_*`), a própria API sincroniza sozinha as empresas de `EMPRESAS_SINCRONIZACAO_BLING`, sem serviço extra no Railway:

- **Ritmo:** o primeiro ciclo roda 1 min depois de a API subir; o seguinte, `BLING_INTERVALO_MINUTOS` (padrão 15) depois do **fim** do anterior, sem sobreposição.
- **Modo:** completa se nunca houve uma ou se a última tem `BLING_COMPLETA_DIAS` (padrão 3) ou mais; senão, incremental, só com o que foi incluído ou alterado no Bling desde o início do último ciclo bem-sucedido (com 10 min de margem). O incremental não vê inativação de produto, troca de tipo de contato nem exclusões: a completa corrige. O botão "Sincronizar dados" sempre faz uma completa.
- **Estado no banco** (`bling_sincronizacoes`): depois de um deploy, continua de onde parou. Um lease (`em_execucao_desde`, validade de 1 h) evita dois ciclos da mesma empresa; se o botão já estiver sincronizando, o ciclo pula a empresa.
- **Sem conexão** (nunca autorizada, ou o refresh venceu): o ciclo registra `nao_conectado` e não chama o Bling; quem tem `ops` autoriza de novo pelo botão no app.
- **Log** (só contagens e códigos, nunca tokens, `code` nem dados de clientes): `Sincronização automática do Bling ligada` ao subir; `… concluída` a cada ciclo, com `empresa`, `tipo`, `produtos`, `clientes` e a quantidade de `avisos`; `… falhou` com o `codigo`; `… sem conexão` só quando a situação muda (não a cada ciclo); `Falha no ciclo …` com o nome do erro, sem parar as outras empresas nem o próximo ciclo.
- **Fechamento:** ao encerrar a API (deploy, `SIGTERM`), o agendador para antes de abortar o job em andamento; um job abortado não registra resultado nem avança a janela.

### Tarefas a partir dos pedidos de venda

Depois de gravar clientes e produtos, cada sincronização concluída (agendada ou pelo botão) lê os pedidos de venda **em aberto** (situação id `6`) com data nos **últimos 30 dias** (lista + um detalhe por pedido, no mesmo ritmo de chamadas; na sincronização incremental, só os alterados na janela e os com data a partir do início dela) e cria uma tarefa de arte para cada cliente × produto que ainda não tem arte nem tarefa aberta (`nao_iniciada`, `em_desenvolvimento` ou `aguardando_cliente`). O cliente é achado pelo id do contato no Bling (senão pelo CNPJ) e o produto pelo código; os que não estão na base só entram num aviso com contagens. A tarefa nasce com `origem = 'bling_pedido'`, o número do pedido e o responsável automático da empresa (o escolhido nas Configurações do app por quem tem `artes.acompanhar`; sem escolha, o único elegível ativo, com `artes.adicionar` e sem `artes.acompanhar`; com mais de um, sem responsável e com aviso). Falha nessa etapa vira aviso e não derruba a sincronização; o log tem só contagens.

Formato confirmado com a conta real em 2026-11-09 (filtro `idsSituacoes[]` pelo id; detalhe com `contato` e `itens[].codigo`). Exige o escopo de leitura de Pedidos de Venda no app do Bling. A janela de 30 dias (`JANELA_PEDIDOS_DIAS`) existe porque a conta tinha 1692 pedidos em aberto desde 2024: um detalhe por pedido a cada ciclo passaria do limite diário do Bling e criaria tarefas para pedidos parados.

## Ambiente

| Variável                                                           | Padrão                                        | Uso                                                                                                        |
| ------------------------------------------------------------------ | --------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `PORT`                                                             | `3001`                                        | porta HTTP                                                                                                 |
| `HOST`                                                             | `::`                                          | interface (todas, IPv4 e IPv6)                                                                             |
| `DATABASE_URL`                                                     | —                                             | banco da API e do `db:migrar` (obrigatória)                                                                |
| `JWT_SEGREDO`                                                      | —                                             | chave do JWT, ao menos 32 bytes (obrigatória)                                                              |
| `DATABASE_URL_TESTE`                                               | `postgres://rpa:rpa@localhost:5433/rpa_teste` | banco dos testes (precisa terminar em `_teste`)                                                            |
| `BLING_CLIENT_ID`, `BLING_CLIENT_SECRET`                           | —                                             | app cadastrado no Bling (opcionais; as quatro `BLING_*` juntas ou nenhuma)                                 |
| `BLING_REDIRECT_URI`                                               | —                                             | link de redirecionamento cadastrado no app do Bling                                                        |
| `BLING_CHAVE_TOKENS`                                               | —                                             | 32 bytes em base64; cifra os tokens do Bling no banco                                                      |
| `BLING_ROMA_CNPJ`                                                  | —                                             | CNPJ (com ou sem máscara, 14 dígitos) da conta do Bling que a Roma pode conectar; fora do grupo das quatro |
| `BLING_SINCRONIZACAO_AUTOMATICA`                                   | `false`                                       | `true` liga o agendador da sincronização (exige as quatro `BLING_*`)                                       |
| `BLING_INTERVALO_MINUTOS`                                          | `15`                                          | minutos entre o fim de um ciclo e o próximo (5 a 1440)                                                     |
| `BLING_COMPLETA_DIAS`                                              | `3`                                           | dias entre duas sincronizações completas (1 a 30)                                                          |
| `ARQUIVOS_S3_ENDPOINT`, `_REGIAO`, `_BUCKET`, `_CHAVE`, `_SEGREDO` | —                                             | bucket S3 dos arquivos (as cinco ou nenhuma; sem elas, `bytea` no Postgres)                                |
| `ARQUIVOS_S3_ESTILO_CAMINHO`                                       | `false`                                       | `true`: endereço `endpoint/bucket/chave` (S3Mock local; Railway conforme a aba Credentials)                |
| `ARQUIVOS_S3_TESTE_URL`                                            | `http://localhost:9090`                       | S3 dos testes (S3Mock)                                                                                     |

Site (`web/`), obrigatórias em produção:

| Variável          | Padrão fora de produção | Uso                                                             |
| ----------------- | ----------------------- | --------------------------------------------------------------- |
| `API_URL_INTERNA` | `http://localhost:3001` | endereço da API visto pelo servidor do site (rede privada)      |
| `SITE_URL`        | `http://localhost:3000` | endereço público do site: base dos redirecionamentos e `Origin` |

Modelo em `.env.example`. Gere o `JWT_SEGREDO` com `node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"`; trocá-lo invalida os tokens de acesso emitidos (as sessões continuam e renovam). Os testes não leem o ambiente: injetam um segredo fictício em `criarApp`. Em produção, as variáveis ficam no painel do Railway; scripts locais contra produção recebem as credenciais via `railway run`. Nunca coloque credenciais no repositório.

**Variáveis no Railway:** uma variável nova ou alterada só vale depois de um deploy. O **Redeploy** de um deploy reaproveita o commit daquele deploy: para aplicar variáveis, faça o Redeploy do deploy mais recente (o da `main` atual). Feito num deploy antigo, a API volta para o código antigo (em 2026-11-09, isso tirou a checagem da conta do Bling e o `conta` do status, e o app mostrou "Resposta do servidor fora do contrato").
