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

O app abre na tela de **Entrar** (e-mail e senha da plataforma). A sessão fica salva até o **Sair** (rodapé do menu): fechar e reabrir não pede a senha de novo. Sem conexão com o servidor, o app abre com o perfil salvo: as automações seguem liberadas e Artes fica indisponível.

- **admin:** vê Artes, Fatura e OP e configura o Bling.
- **arte finalista:** vê só Artes, sem Configurações do Bling.

O topo do menu mostra a empresa em uso (ABA Embalagens, Roma…). Com mais de uma, clique nele para trocar; a troca fica bloqueada durante uma execução. Tema, logo e título da janela acompanham a empresa, e a última escolhida volta ao reabrir. Empresa sem logo cadastrada (hoje a Roma) mostra só o nome.

### Configurações do app

O botão **Configurações** (no cabeçalho, só para o admin) guarda **por usuário e por empresa** o usuário e a senha do Bling e a pasta padrão dos documentos; o caminho do Chrome (opcional) vale para o usuário. Se a empresa em uso não tem usuário, senha ou pasta, a tela abre sozinha ao entrar ou ao trocar para ela (não bloqueia; a execução da Fatura valida de novo). Os valores ficam em `data/settings.json` (em dev, na raiz do projeto; no app instalado, em `%APPDATA%\RPA Bling\data`). A senha é cifrada pelo Windows (DPAPI, via `safeStorage` do Electron) e só pode ser lida pelo mesmo usuário na mesma máquina. Senha em branco mantém a atual, mas é obrigatória no primeiro salvamento de cada empresa.

Cada usuário e empresa tem o seu perfil do Chrome (`data/chrome/<usuário>/<empresa>`), para a sessão do Bling de uma empresa nunca ser reaproveitada na outra. O arquivo de configurações do formato antigo (sem dono) não é lido nem apagado: cada admin preenche de novo, por empresa.

Ordem de prioridade: Configurações > `.env` > padrões; as credenciais do Bling vêm só das Configurações da empresa, nunca do `.env`. Se o Chrome não estiver no caminho configurado, o robô tenta `%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe` (instalação por usuário).

## Instalar o app em outra máquina

Requisitos: Windows 10/11 e Google Chrome instalado. Não precisa de Node nem de Git.

1. Baixe `RPA-Bling-Setup-<versão>.exe` do [último Release](https://github.com/guialvesgalvao/rpa/releases/latest) e execute. A instalação é por usuário (`%LOCALAPPDATA%\Programs\RPA Bling`) e não pede administrador.
2. O instalador não é assinado, então o Windows mostra "O Windows protegeu o computador": clique em **Mais informações → Executar assim mesmo** (só na primeira instalação).
3. Abra **RPA Bling** pelo Menu Iniciar, entre com a sua conta e, se for admin, preencha as **Configurações** de cada empresa.

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
```

> Nunca coloque credenciais no código; use o `.env` (já ignorado pelo git).
