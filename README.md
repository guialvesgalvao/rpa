# RPA — Node + TypeScript + Playwright

Base para automações de processos que usam o navegador, salvam/leem arquivos (inclusive em pastas do Windows via WSL) e manipulam PDFs.

## Requisitos

- Node 22+ (testado com 24)
- Google Chrome instalado (padrão `BROWSER_CHANNEL=chrome`)
- WSL2 (para modo `--headed` é preciso WSLg / Windows 11)

## Instalação

```bash
npm install
npm run browsers:install          # só se usar BROWSER_CHANNEL=chromium
cp .env.example .env              # ajuste as pastas
```

Se o Chromium reclamar de bibliotecas do sistema: `sudo npx playwright install-deps chromium`.

## Configuração (`.env`)

| Variável             | Padrão                                                  | Descrição                                         |
| -------------------- | ------------------------------------------------------- | ------------------------------------------------- |
| `RPA_INPUT_DIR`      | `data/input`                                            | Pasta de entrada (`C:\...` ou `/mnt/c/...`)       |
| `RPA_OUTPUT_DIR`     | `data/output`                                           | Pasta de saída                                    |
| `RPA_DOWNLOAD_DIR`   | `data/downloads`                                        | Onde os downloads do navegador são salvos         |
| `BROWSER_CHANNEL`    | `chrome`                                                | `chrome` (Chrome da máquina) ou `chromium`        |
| `CHROME_PROFILE_DIR` | `data/chrome-profile`                                   | Perfil persistente do Chrome usado pelo RPA       |
| `CHROME_PATH`        | `C:\Program Files\Google\Chrome\Application\chrome.exe` | Executável do Chrome                              |
| `HEADLESS`           | `true`                                                  | `false` abre o navegador visível                  |
| `SLOW_MO`            | `0`                                                     | Atraso (ms) entre ações, útil para depurar        |
| `TIMEOUT_MS`         | `30000`                                                 | Timeout padrão das ações do Playwright            |
| `LOG_LEVEL`          | `info`                                                  | `trace` \| `debug` \| `info` \| `warn` \| `error` |
| `BLING_USER`         | —                                                       | Usuário-robô do Bling (e-mail/usuário)            |
| `BLING_PASSWORD`     | —                                                       | Senha do usuário-robô                             |
| `BLING_BOLETOS_DIR`  | `data/boletos`                                          | Pasta padrão dos boletos em PDF                   |

`BLING_USER`/`BLING_PASSWORD` são obrigatórios para os processos do Bling na CLI: o robô entra pelo formulário de usuário/senha, depois que a tela de login carrega o token de segurança (CSRF). No app, o usuário, a senha e a pasta do Bling são definidos em **Configurações**, por usuário e empresa, e não herdam o `.env` (ver [Configurações do app](#configurações-do-app)).

No WSL, caminhos do Windows (`C:\Users\...`) são convertidos automaticamente para `/mnt/c/Users/...`; rodando nativo no Windows, são usados como estão.

Com `BROWSER_CHANNEL=chrome`, o RPA usa o Chrome instalado com um perfil próprio em `CHROME_PROFILE_DIR` (o Chrome 136+ bloqueia automação no perfil pessoal; cookies ficam salvos entre execuções). Esse perfil não pode estar aberto em outra janela/execução ao mesmo tempo.

## Executando

```bash
npm run process -- exemplo             # headless
npm run process -- exemplo --headed    # navegador visível
npm run process -- bling 101 102      # Bling: boleto e recibo (PDF) dos pedidos 101 e 102 (sempre com janela)
npm run process -- bling 101 --docs=recibo   # só os documentos escolhidos (boleto, recibo, nf)
npm run process -- bling 101 --docs=nf --ensaio-nf   # NF em ensaio: abre a nota e para antes de Salvar
npm run process -- <nome> arg1 arg2    # args ficam em ctx.args
```

Na CLI do Bling, `--docs=` escolhe os documentos (separados por vírgula: `boleto`, `recibo`, `nf`). Sem ele, gera **boleto e recibo**; a NF só sai quando pedida. Antes, a CLI gerava só o boleto. Documento desconhecido encerra com erro antes de abrir o navegador. `--ensaio-nf` (exige `nf` em `--docs`) abre o formulário da nota, lê o número e fecha **sem salvar**: nada é criado nem emitido. Existe só na CLI; o app sempre emite de verdade.

### App de documentos do Bling (POC)

```bash
npm run app        # compila src/app (dist/app) e abre a janela
```

1. **Informe os pedidos:** cole os números (um por linha, ou separados por vírgula/espaço) e/ou preencha o **Intervalo De/Até** (inclusivo, crescente ou decrescente, até 200 pedidos). A lista final é a união sem repetidos: primeiro o texto, depois o intervalo.
2. **Confira a seleção:** clique em **Confirmar seleção**. Aparece um bloco por pedido, com checkbox no pedido e nos documentos (**Boleto**, **Recibo**, **Nota fiscal**). Documento ainda não disponível aparece desabilitado, com a marca "em breve" (hoje todos estão disponíveis). Novos pedidos entram com Boleto e Recibo marcados e Nota fiscal desmarcada. Pedido desmarcado, ou sem documento marcado, fica de fora. Se o texto ou o intervalo mudar depois de confirmar, o app avisa "Seleção desatualizada — confirme novamente" e só libera a geração depois de confirmar de novo. As escolhas dos pedidos que continuam na lista são mantidas.
3. **Gere os documentos:** escolha a pasta e clique em **Gerar documentos**. O resultado mostra uma linha por documento de cada pedido, com o status. Quando um documento termina em erro, aparece o **Passo a passo** do que o robô fez até falhar.

Para cada pedido, o robô primeiro abre o pedido (clique no Número) só para ler o cliente e os vencimentos das parcelas, e volta à listagem sem salvar. Se essa leitura falhar, todos os documentos do pedido falham. A falha de um documento não interrompe os demais.

Como funciona o boleto: o robô aciona **⋮ → Emitir boletos** (o Bling lança as contas a receber do pedido) e o Bling abre o PDF numa nova guia; o robô baixa esse PDF pela URL da guia (com a sessão do navegador), confere que é um PDF, separa as páginas e salva **um arquivo por parcela** (a página _i_ é a parcela _i_): `Boleto <cliente> DD MM AA.pdf`. O cliente é o nome fantasia ou, se não houver, o nome principal. Se o número de páginas for diferente do de parcelas, nada é salvo. Se o nome já existir, o arquivo ganha ` (2)`, ` (3)`… e nada é sobrescrito. Se o pedido já tem nota e nenhuma conta lançada, o Bling oculta "Emitir boletos" e o boleto termina em erro.

Como funciona o recibo: o robô aciona **⋮ → Imprimir**, escolhe **Ordem: Inserção** e confirma. O Bling abre o pedido em HTML numa nova guia, e o robô a salva como PDF (A4) em `Recibo <cliente> <vencimentos>.pdf`, por exemplo `Recibo Cliente 25 10 - 01 11 - 08 11 26.pdf` (só a última data leva o ano). O diálogo de impressão do Chrome é suprimido. O recibo não tem efeito fiscal.

Como funciona a nota fiscal (**emite NF-e de verdade**, com efeito fiscal se a conta estiver em produção): se o pedido já tem NF, termina em erro "Pedido já possui NF" sem clicar em nada. Senão, o robô aciona **⋮ → Gerar nota fiscal** (o Bling abre o formulário numa nova guia), espera o Bling calcular os impostos, lê o número que a nota vai receber e clica em **Salvar**. Em seguida busca a nota na lista de notas, aciona **⋮ → Enviar nota fiscal**, deixa **desmarcados** "Lançar contas", "Lançar estoque" e "Enviar por e-mail", confirma e espera "NF-e autorizada com sucesso!". Depois clica em **Imprimir DANFE** e salva a guia como PDF em `NF <número> <cliente> <vencimentos>.pdf`. Se o Bling recusar o Salvar, a nota não é criada e o erro traz o motivo (problema no item **Frete** tem mensagem própria). Qualquer erro depois do Salvar diz "NF X criada, mas não autorizada/baixada — verifique no Bling": confira no Bling antes de rodar de novo.

- Logs: terminal + `logs/<processo>_<data>.log` (JSON).
- Em erro no navegador: screenshot e trace em `artifacts/`. Abra o trace com `npx playwright show-trace artifacts/trace_*.zip`.

### Login, perfis e empresas

O app abre na tela de **Entrar** (e-mail e senha da plataforma). A sessão fica salva até o **Sair** (rodapé do menu): fechar e reabrir não pede a senha de novo. Sem conexão com o servidor, o app abre com as permissões salvas: as automações seguem liberadas e Artes fica indisponível.

O que cada pessoa vê depende das **permissões**, marcadas por empresa no painel de usuários (ADR 0011). Cada aba tem a sua permissão: **Artes** (com "adicionar novas", "editar e excluir" e "acompanhar todas as tarefas"), **Fatura**, **OP** (só na Roma), **Compras** (só na Roma, com "fazer pedidos" e "acompanhar todos os pedidos") e **Usuários** (com "editar permissão" e "editar e excluir usuários"). As credenciais do Bling em Configurações são de quem tem Fatura ou OP; a sincronização, de quem tem OP na Roma. Sem nenhuma permissão na empresa, o app e o site avisam que falta acesso. Os antigos administradores ficaram com todas as permissões, e as antigas arte-finalistas com Artes + "adicionar novas".

Quem foi criado pela tela entra com a senha inicial e cai direto na troca de senha (app e site); depois da troca, as outras sessões dessa pessoa são encerradas.

**Usuários** (app e site): lista os usuários da empresa com a área (Arte Finalista, Produção, Administração ou Direção; "Sem área" nos antigos). Com "editar e excluir usuários", cria (nome, e-mail, área, empresas e senha inicial), edita os dados e exclui (o usuário perde o acesso na hora e o e-mail continua bloqueado). Com "editar permissão de usuários", marca as permissões, um bloco por empresa. Ninguém exclui a si mesmo nem tira a própria permissão de editar permissões, e cada empresa mantém ao menos uma pessoa com ela. Trocar a senha de outro usuário continua na CLI (`plataforma/README.md`).

O topo do menu mostra a empresa em uso (ABA Embalagens, Roma…). Com mais de uma, clique nele para trocar; a troca fica bloqueada durante uma execução. Tema, logo e título da janela acompanham a empresa, e a última escolhida volta ao reabrir. Empresa sem logo cadastrada mostra só o nome.

### Catálogo, clientes e artes

- **Catálogo:** os produtos que a fábrica produz (ex.: caixa de pizza 35x35), cadastrados no Bling. É o mesmo para todos os clientes da empresa.
- **Cliente:** quem compra da fábrica (ex.: uma pizzaria), também vindo do Bling.
- **Arte:** a estampa de um produto do catálogo feita para um cliente específico (ex.: a caixa 35x35 com a marca da pizzaria). Tem ao menos um arquivo (PDF ou imagem), cor e máquinas (Favorit, Rekord e Ultra; uma ou mais). Se a cor não está na lista, **+ Nova cor** a cria ali mesmo, só com o nome (sem diferenciar maiúsculas nem acentos de uma existente).

O fluxo é este: o cliente pede à fábrica um produto do catálogo. Se ainda não há arte dele para esse produto, ou se ele quer uma nova, o arte-finalista desenvolve a arte e a cadastra para esse cliente e produto. A OP usa essa arte. Não existe vínculo direto entre cliente e produto: é a arte que liga os dois. Por isso a lista de produtos de um cliente mostra só os que já têm arte, e o cadastro de uma arte nova escolhe o produto no catálogo inteiro.

### Tarefas de desenvolvimento de arte

Na página do cliente (app e site), o bloco **Novo trabalho de arte** escolhe um produto do catálogo e oferece duas saídas:

- **Inserir arte pronta:** abre o formulário de nova arte com o produto já escolhido (o cadastro de sempre).
- **Iniciar desenvolvimento:** cria uma **tarefa** para esse produto e cliente, com status **Não iniciado** e quem a criou como responsável. Não pede nenhum outro campo: a tarefa serve para registrar quando a arte começou e terminou e para consultar quais estão em produção (ex.: "Arte de Caixa de pizza 35x35 para Pizzaria Ficticia").

Status: **Não iniciado**, **Em desenvolvimento**, **Aguardando validação do cliente**, **Concluída** e **Cancelada**. Quem tem Artes pode mudar para qualquer um. **Concluída** exige a arte: escolher Concluída (ou "Concluir com a arte") abre o formulário de nova arte com o cliente e o produto da tarefa, e salvar cadastra a arte e conclui, de uma vez. Uma tarefa concluída pode voltar a outro status; a arte continua vinculada e não pode ser removida enquanto a tarefa existir.

Cada tarefa tem **comentários** (autor e data/hora), com até 5 **anexos** por comentário (PDF ou imagem; texto opcional quando há anexo), e um **Histórico** com cada mudança de status (de → para, autor, data/hora), desde a criação. No app, **Anexar** escolhe os arquivos e **Baixar** pede onde salvar; no site, o campo de arquivos e os links de download.

No topo da home de Artes ficam os atalhos **Pendentes**, **Em andamento**, **Aguardando validação** (com o contador entre parênteses) e **Todos**, que abrem a lista já filtrada. Quem tem "acompanhar todas as tarefas" conta e vê todas as da empresa; os demais, só as de que são responsáveis, sem ver nem alterar as de outros.

**Tarefas automáticas:** a sincronização com o Bling cria tarefas a partir dos pedidos de venda em aberto quando o cliente ainda não tem arte para o produto (detalhes em `plataforma/README.md`). Elas vão para o **responsável pelas tarefas automáticas**, escolhido nas Configurações do app por quem acompanha todas as tarefas; sem escolha, para a única pessoa elegível da empresa (com "adicionar novas" e sem "acompanhar todas as tarefas").

### Compras

Pedidos de compra de insumos, no app e no site, só na Roma (ADR 0012). Insumo é o produto ativo do Bling com código começando por `TPP`, vindo da sincronização. O pedido tem insumo, quantidade (até 3 casas decimais) e observação opcional, e guarda quem pediu, a área dessa pessoa naquele momento, a data, o responsável e o status: **Aberta**, **Em andamento**, **Concluída** ou **Cancelada**.

- **Fazer pedidos:** cria pedidos e vê os próprios. Edita insumo, quantidade e observação enquanto o pedido não terminou e cancela o próprio pedido enquanto está Aberta.
- **Acompanhar todos os pedidos:** vê todos, **assume** (vira responsável e o pedido passa para Em andamento), muda para qualquer status, edita e comenta em qualquer um.

A lista filtra por **Meus pedidos** (criados ou assumidos), **Em aberto** e, para quem acompanha, **Todos**, além do status. Cada pedido tem comentários com até 5 anexos (PDF ou imagem, como nas tarefas de arte) e um **Histórico** com a criação, as edições (antes → depois), o responsável e as mudanças de status.

### OP: pré-preencher dados

Na lista de pedidos da aba OP, cada produto marcado tem o botão **Pré-preencher OP**. Ele abre um formulário com os campos que antes saíam sempre em branco no PDF:

- **Data entrega de produção**;
- **Descrição do Processo:** para cada um dos 7 passos, Sim/Não, Quantidade, Responsável e Data (o Visto continua para o papel);
- **Observação:** até 400 caracteres e 4 linhas; as quebras a mais viram espaço, para a OP continuar em 1 página. Já vem com as **Observações do pedido de venda** (as do Bling, não as internas), a mesma em todos os produtos do pedido, e vai na OP mesmo sem abrir o formulário; dá para editar ou apagar. Se a do pedido passa do limite, vem cortada, com um aviso no formulário.

Ao clicar em **Gerar OPs**, um diálogo lista, agrupado por pedido, cada produto e a arte escolhida (`→ sem arte` quando não houver); só **Gerar OPs** no diálogo gera, **Cancelar** ou Esc não gera nada.

Salvo (ou quando o pedido já traz observação), o botão vira **Editar dados da OP ✓** e o resumo da seleção conta as OPs pré-preenchidas. A geração usa esses dados; campo vazio sai em branco, como antes. O pré-preenchimento vale só para a próxima geração: fica na tela enquanto o pedido estiver na lista (inclusive ao buscar de novo) e não é salvo em lugar nenhum.

### Configurações do app

O botão **Configurações** (no cabeçalho) guarda, para quem tem Fatura ou OP, **por usuário e por empresa** o usuário e a senha do Bling e a pasta padrão dos documentos; o caminho do Chrome (opcional) vale para o usuário. Se a empresa em uso não tem usuário, senha ou pasta, a tela abre sozinha ao entrar ou ao trocar para ela (não bloqueia; a execução da Fatura valida de novo). Os valores ficam em `data/settings.json` (em dev, na raiz do projeto; no app instalado, em `%APPDATA%\RPA Bling\data`). A senha é cifrada pelo Windows (DPAPI, via `safeStorage` do Electron) e só pode ser lida pelo mesmo usuário na mesma máquina. Senha em branco mantém a atual, mas é obrigatória no primeiro salvamento de cada empresa.

Cada usuário e empresa tem o seu perfil do Chrome (`data/chrome/<usuário>/<empresa>`), para a sessão do Bling de uma empresa nunca ser reaproveitada na outra. O arquivo de configurações do formato antigo (sem dono) não é lido nem apagado: cada usuário preenche de novo, por empresa.

**Sincronizar dados** (só quem tem OP na Roma; o bloco não aparece na ABA nem para quem não tem OP) lê os produtos e os clientes ativos do Bling pela API da plataforma (API v3 do Bling, só leitura). Na primeira vez, ou quando a conexão vence, o app abre a autorização do Bling no navegador; depois de autorizar, clique de novo. O progresso aparece no bloco, e o botão fica desabilitado até o fim, mesmo fechando e reabrindo Configurações. Os dados vão para o banco da plataforma (os clientes e produtos usados nas artes e na OP), e o app mostra apenas as contagens. Uma segunda linha no bloco mostra a **sincronização automática** do servidor: "desligada no servidor", ou o intervalo, o último ciclo (hora, tipo completa/incremental, clientes e produtos atualizados, até três avisos), uma falha com a mensagem, "Bling não conectado" (clique em Sincronizar dados para autorizar) e a data da próxima completa. Ela é atualizada ao abrir Configurações e ao fim do clique. Sem a configuração do Bling no servidor, a mensagem é "Sincronização não configurada no servidor." (detalhes em `plataforma/README.md`).

Só em dev (ignoradas no app instalado), duas variáveis isolam o app, como faz a suíte E2E: `RPA_DATA_DIR` troca a pasta de `data/` e `logs/` (e o perfil do Electron, então o app de dev pode estar aberto ao mesmo tempo) e `RPA_API_URL` troca, sem recompilar, a URL da API embutida no build.

Ordem de prioridade: Configurações > `.env` > padrões; as credenciais do Bling vêm só das Configurações da empresa, nunca do `.env`. Se o Chrome não estiver no caminho configurado, o robô tenta `%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe` (instalação por usuário).

## Instalar o app em outra máquina

Requisitos: Windows 10/11 e Google Chrome instalado. Não precisa de Node nem de Git.

1. Baixe `RPA-Bling-Setup-<versão>.exe` do [último Release](https://github.com/guialvesgalvao/rpa/releases/latest) e execute. A instalação é por usuário (`%LOCALAPPDATA%\Programs\RPA Bling`) e não pede administrador.
2. O instalador não é assinado, então o Windows mostra "O Windows protegeu o computador": clique em **Mais informações → Executar assim mesmo** (só na primeira instalação).
3. Abra **RPA Bling** pelo Menu Iniciar, entre com a sua conta e, se tiver Fatura ou OP, preencha as **Configurações** de cada empresa.

No app instalado, perfil do Chrome, logs (`logs/`) e falhas (`artifacts/`) ficam em `%APPDATA%\RPA Bling`, e a pasta padrão dos documentos é `Documentos\RPA Bling`.

**Atualizações:** ao abrir (e a cada 4 horas), o app procura uma versão nova nos Releases e a baixa em segundo plano. Quando termina, aparece a faixa "Nova versão X baixada" com **Reiniciar e atualizar**, que fica bloqueado enquanto há uma geração em andamento. Se o app só for fechado, a atualização é instalada ao sair.

## Lançar uma nova versão

Na `main`, com as mudanças já commitadas:

```bash
npm version patch          # ou minor/major: altera package.json e cria a tag vX.Y.Z
git push --follow-tags     # envia o commit e a tag
```

A tag dispara o workflow `.github/workflows/release.yml`: validações (typecheck, lint, format, testes), build e publicação do instalador no GitHub Release (`Setup.exe`, `latest.yml`, `.blockmap`). O workflow falha se a tag não bater com a versão do `package.json`. Para gerar o instalador só localmente, sem publicar: `npm run dist` (saída em `release/`).

## Criando um novo processo

Crie `src/processes/<nome>/index.ts`:

```ts
import path from 'node:path';

import { withBrowser } from '../../core/browser.js';
import { defineProcess } from '../../core/process.js';
import { saveDownload } from '../../utils/download.js';
import { splitPdf } from '../../utils/pdf.js';

export default defineProcess({
  name: 'meu-processo',
  async run({ config, logger, args }) {
    const file = await withBrowser(config, logger, async ({ page }) => {
      await page.goto('https://sistema.exemplo.com');
      return saveDownload(
        page,
        () => page.getByRole('link', { name: 'Exportar PDF' }).click(),
        config.downloadDir,
      );
    });
    const parts = await splitPdf(file, path.join(config.outputDir, 'separados'));
    logger.info({ parts: parts.length }, 'PDF separado');
  },
});
```

## Utilitários

- `src/core/browser.ts` — `withBrowser`: abre/fecha o Chromium, timeout padrão, artefatos em falha.
- `src/utils/download.ts` — `saveDownload(page, trigger, destDir, fileName?)`.
- `src/utils/pdf.ts` — `splitPdf`, `splitPdfByRanges` (intervalos 1-based inclusivos), `mergePdfs`, `countPages`.
- `src/utils/fs.ts` — `ensureDir`, `safeFileName`, `timestampedName`, `toWslPath`.

## Plataforma (API)

A pasta `plataforma/` guarda a API (Fastify) e os contratos zod usados pela API, pelo site e pelo app. Ela tem `package.json`, lockfile, tooling e CI próprios (`.github/workflows/plataforma-ci.yml`), e não usa as tags `v*` do app. Veja `plataforma/README.md`.

## Qualidade

```bash
npm run typecheck
npm run lint
npm run format:check
npm test
npm run e2e        # suíte E2E local: site + app contra a API e o banco `rpa_e2e` (ADR 0010)
```

A suíte E2E (`e2e/`, Playwright) precisa de Docker, de `npm --prefix plataforma ci` e do Chromium (`npm run browsers:install`). Ela sobe o Postgres, recria o banco `rpa_e2e` com dados fictícios, sobe a API na porta 3101 e o site na 3100, e abre o app numa pasta de dados temporária, com `RPA_OP_MOCK=1`. Nunca usa o Bling nem o `.env`. Relatório: `npx playwright show-report`. Só um grupo: `npm run e2e -- --project=site` (ou `app`), ou `-g "<trecho do nome>"`.

> Nunca coloque credenciais no código; use o `.env` (já ignorado pelo git).
