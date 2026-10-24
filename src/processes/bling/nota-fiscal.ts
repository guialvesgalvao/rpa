import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Dialog, Locator, Page } from 'playwright';

import type { Rastro } from '../../core/rastro.js';
import { ensureDir } from '../../utils/fs.js';
import type { ContextoDoc, SaidaDoc } from './documentos.js';
import {
  abrirNovaGuia,
  buscarPedido,
  clicarNoMenu,
  interceptarImpressao,
  ItemDeMenuAusente,
  linhaPorNumero,
  pdfDaGuiaImpressa,
  SEARCH_INPUT,
} from './guia.js';
import { caminhoLivre, nomeNf } from './nomes.js';
import type { DadosPedido } from './pedido.js';

const MENU_GERAR = 'Gerar nota fiscal';
const MENU_ENVIAR = 'Enviar nota fiscal';
const JA_POSSUI_NF = 'Pedido já possui NF — verifique no Bling';
const INDISPONIVEL =
  'Gerar nota fiscal indisponível no Bling para este pedido — verifique no Bling';
/** "Gerar nota fiscal" abre o formulário numa nova guia, `notas.fiscais.php?idOrigem=<idVenda>`. */
const GUIA_NF = '/notas.fiscais.php';
const NOTAS_URL = 'https://www.bling.com.br/notas.fiscais.php#list';
/** API interna que a tela usa para carregar a lista de notas. */
const LISTA_NOTAS_API = 'notas.fiscais.server.php?f=listarNotasFiscais';
const SALVAR = '#botaoSalvar';
/**
 * O formulário chama `calcularImpostos` ao abrir, e só aí os itens recebem CFOP e tributação.
 * Salvar antes disso é recusado pelo Bling (achado da Task 7).
 */
const CALCULAR_IMPOSTOS = 'notas.fiscais.server.php?f=calcularImpostos';
/** A guia do DANFE é HTML (`relatorios/danfe.php?idNota1=<id>`) e chama window.print(), como o recibo. */
const GUIA_DANFE = 'danfe.php';
const AUTORIZADA = 'NF-e autorizada com sucesso!';
const NAO_VALIDADA = 'Nota fiscal eletrônica não foi validada!';
/** Opções do painel de envio que o robô sempre deixa desmarcadas (decisão do usuário na Task 7). */
const OPCOES_DESMARCADAS: Record<string, string> = {
  '#enviarNotaLancarContas': 'Lançar contas',
  '#enviarNotaLancarEstoque': 'Lançar estoque',
  '#enviarNotaPorEmail': 'Enviar por e-mail',
};
const GUIA_TIMEOUT_MS = 30_000;
const SALVAR_TIMEOUT_MS = 60_000;
/** A autorização passa pela assinatura e pela SEFAZ; pode demorar bem mais que o resto. */
const AUTORIZACAO_TIMEOUT_MS = 180_000;

/**
 * Número que a nota vai receber. O campo Número fica vazio, com o próximo número da série como
 * placeholder e em `#proximoNumero`; sem nada digitado, a nota sai com esse número. O
 * `#proximoNumero` nasce com "1" e só depois recebe o número da série, junto com o placeholder.
 */
async function lerNumeroNf(guia: Page): Promise<string> {
  await guia.waitForFunction(
    () => {
      const placeholder = document.querySelector<HTMLInputElement>('#numero')?.placeholder;
      const proximo = document.querySelector<HTMLInputElement>('#proximoNumero')?.value;
      return !!placeholder && placeholder === proximo;
    },
    undefined,
    { timeout: GUIA_TIMEOUT_MS },
  );
  const campo = guia.locator('#numero');
  const numero = (await campo.inputValue()).trim() || (await campo.getAttribute('placeholder'))!;
  if (!/^\d+$/.test(numero)) throw new Error(`Número da nota inválido: "${numero}"`);
  return numero;
}

/** O Bling validou o formulário e recusou salvar: a nota não foi criada. */
class NfNaoSalva extends Error {}

/** Problema do Bling que cita o item "Frete" (ex.: "Problema com o item 2 - Frete: unidade…"). */
const PROBLEMA_FRETE = /\bitem \d+ - Frete\b/i;
const MENSAGEM_FRETE =
  'o item Frete do pedido não tem os dados fiscais exigidos pelo Bling (unidade, NCM, Cód. Lista Serviços) — verifique no Bling';

/**
 * Mensagem de erro para a recusa do Bling ao salvar a nota, a partir dos problemas que ele lista.
 * O problema no item Frete tem descrição própria (decisão dos stakeholders, Task 7): é um erro
 * esperado, e o texto do Bling não ajuda quem opera o robô.
 */
export function mensagemNfRecusada(problemas: string[], texto: string): string {
  const limpos = problemas.map((p) => p.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const outros = limpos.filter((p) => !PROBLEMA_FRETE.test(p));
  if (outros.length < limpos.length) {
    const resto = outros.length ? `. Outros problemas: ${outros.join('; ')}` : '';
    return `NF não criada: ${MENSAGEM_FRETE}${resto}`;
  }
  const detalhe =
    limpos.join('; ') ||
    texto
      .replace(/\s+/g, ' ')
      .replace(/^Atenção /, '')
      .trim();
  return `NF não criada: ${detalhe}`;
}

/**
 * Clica em Salvar e espera o formulário sair de cena. Se o Bling recusar, ele mostra o aviso em
 * `#mensagem` ("Não foi possível salvar a Nota Fiscal…", achado da Task 7) e a nota não existe.
 */
async function salvarNota(guia: Page): Promise<void> {
  const avisos: string[] = [];
  const registrar = (dialog: Dialog) => {
    avisos.push(dialog.message());
    void dialog.dismiss().catch(() => undefined);
  };
  const salvar = guia.locator(SALVAR);
  const recusa = guia.locator('#mensagem.alert-box-warning').filter({ visible: true });
  guia.on('dialog', registrar);
  try {
    await salvar.click();
    // 'hidden' também cobre o botão removido, caso a guia navegue depois de salvar.
    const resultado = await Promise.race([
      salvar.waitFor({ state: 'hidden', timeout: SALVAR_TIMEOUT_MS }).then(() => 'salva'),
      recusa.waitFor({ timeout: SALVAR_TIMEOUT_MS }).then(() => 'recusada'),
    ]).catch(() => {
      const detalhe = avisos.length ? `: ${avisos.join(' / ')}` : '';
      throw new Error(`O Bling não saiu do formulário da nota depois de Salvar${detalhe}`);
    });
    if (resultado === 'recusada') {
      const problemas = await recusa.locator('li').allInnerTexts();
      throw new NfNaoSalva(mensagemNfRecusada(problemas, await recusa.innerText()));
    }
  } finally {
    guia.off('dialog', registrar);
  }
}

/** Abre a lista de notas na guia e devolve a linha da nota `numeroNf`. */
async function buscarNota(guia: Page, numeroNf: string): Promise<Locator> {
  // A lista carrega sozinha ao abrir; a busca só começa depois, para não ser sobrescrita.
  const inicial = guia
    .waitForResponse((r) => r.url().includes(LISTA_NOTAS_API), { timeout: GUIA_TIMEOUT_MS })
    .catch(() => undefined);
  await guia.goto(NOTAS_URL, { waitUntil: 'load' });
  await inicial;
  const busca = guia.locator(SEARCH_INPUT);
  await busca.fill(numeroNf);
  const carregou = guia.waitForResponse((r) => r.url().includes(LISTA_NOTAS_API), {
    timeout: 15_000,
  });
  await busca.press('Enter');
  await carregou;

  const row = linhaPorNumero(guia, numeroNf);
  await row
    .first()
    .waitFor({ timeout: 15_000 })
    .catch(() => {
      throw new Error(`NF ${numeroNf} não encontrada na lista de notas.`);
    });
  const count = await row.count();
  if (count > 1) throw new Error(`Mais de uma NF com número ${numeroNf} (${count}).`);
  return row;
}

/** Desmarca a opção do painel de envio. O envio lê a propriedade `checked` de cada caixa. */
async function desmarcar(guia: Page, seletor: string, rotulo: string): Promise<void> {
  const caixa = guia.locator(seletor);
  if (!(await caixa.count()))
    throw new Error(`Opção "${rotulo}" não encontrada no painel de envio`);
  if (await caixa.isChecked()) {
    await caixa.evaluate((el: HTMLInputElement) => {
      el.checked = false;
      el.dispatchEvent(new Event('change', { bubbles: true }));
    });
  }
  if (await caixa.isChecked()) throw new Error(`Não consegui desmarcar "${rotulo}"`);
}

/**
 * Envia a nota `numeroNf` (já salva) pela lista de notas, espera a autorização e salva o DANFE
 * em PDF. Separado de `gerarNf` para poder retomar uma nota que ficou salva sem autorização.
 */
export async function enviarEBaixarNf(
  guia: Page,
  numeroNf: string,
  { cliente, parcelas }: DadosPedido,
  destDir: string,
  rastro: Rastro,
): Promise<SaidaDoc> {
  const row = await rastro.etapa(`Abri a lista de notas e busquei ${numeroNf}`, () =>
    buscarNota(guia, numeroNf),
  );
  await rastro.etapa(`Abri o menu ⋮ e cliquei em ${MENU_ENVIAR}`, () =>
    clicarNoMenu(row, MENU_ENVIAR),
  );
  const painel = guia
    .locator('.ui-dialog')
    .filter({ has: guia.locator('#interfaceNotas'), visible: true });
  const enviar = painel.getByRole('button', { name: MENU_ENVIAR, exact: true });
  const opcoes = Object.values(OPCOES_DESMARCADAS).join(', ');
  await rastro.etapa(`Deixei desmarcado: ${opcoes}`, async () => {
    // O botão só aparece depois que o Bling confere o certificado digital.
    await enviar.waitFor({ timeout: GUIA_TIMEOUT_MS });
    for (const [seletor, rotulo] of Object.entries(OPCOES_DESMARCADAS)) {
      await desmarcar(guia, seletor, rotulo);
    }
  });
  await rastro.etapa('Confirmei no diálogo', () => enviar.click());
  await rastro.etapa('NF-e autorizada com sucesso', async () => {
    const autorizada = painel.getByText(AUTORIZADA).first();
    const recusada = painel.getByText(NAO_VALIDADA).or(painel.locator('.Alert--error')).first();
    await autorizada.or(recusada).first().waitFor({ timeout: AUTORIZACAO_TIMEOUT_MS });
    if (!(await autorizada.isVisible())) {
      const motivo = (await painel.innerText()).replace(/\s+/g, ' ').trim().slice(0, 300);
      throw new Error(`NF-e não autorizada: ${motivo}`);
    }
  });

  const semPrint = await interceptarImpressao(guia);
  let danfe: Page | undefined;
  try {
    danfe = await rastro.etapa('Cliquei em Imprimir DANFE', () =>
      abrirNovaGuia(guia, () =>
        painel.getByRole('button', { name: 'Imprimir DANFE', exact: true }).click(),
      ),
    );
    const aberta = danfe;
    const pdf = await rastro.etapa('Baixei o PDF', () =>
      pdfDaGuiaImpressa(aberta, GUIA_DANFE, 'DANFE'),
    );
    const destino = await caminhoLivre(
      await ensureDir(destDir),
      nomeNf(numeroNf, cliente, parcelas),
    );
    // 'wx': nunca sobrescreve um arquivo existente.
    await rastro.etapa(`Salvei ${path.basename(destino)}`, () =>
      writeFile(destino, pdf, { flag: 'wx' }),
    );
    return { arquivos: [destino], detalhe: `NF ${numeroNf} autorizada` };
  } finally {
    await semPrint.dispose().catch(() => undefined);
    await danfe?.close().catch(() => undefined);
  }
}

/**
 * Busca o pedido na listagem de vendas (já aberta), aciona "⋮ → Gerar nota fiscal", salva a nota,
 * envia, espera a autorização e salva o DANFE em PDF. Pedido que já tem NF termina em erro sem
 * clicar em nada. Em ensaio (`ensaioNf`), fecha o formulário sem salvar: nada é criado nem emitido.
 */
export async function gerarNf({
  page,
  numero,
  dados,
  destDir,
  rastro,
  ensaioNf,
}: ContextoDoc): Promise<SaidaDoc> {
  await rastro.etapa('Conferi que o pedido ainda não tem NF', async () => {
    if (dados.possuiNf) throw new Error(JA_POSSUI_NF);
  });
  const row = await rastro.etapa(`Busquei o pedido ${numero} na listagem`, () =>
    buscarPedido(page, numero),
  );
  const guia = await rastro.etapa(`Abri o menu ⋮ e cliquei em ${MENU_GERAR}`, () =>
    abrirNovaGuia(page, () =>
      clicarNoMenu(row, MENU_GERAR).catch((error: unknown) => {
        throw error instanceof ItemDeMenuAusente ? new Error(INDISPONIVEL) : error;
      }),
    ),
  );
  // A guia acabou de nascer: a espera começa antes da chamada, para não perder a resposta.
  const impostos = guia.waitForResponse((r) => r.url().includes(CALCULAR_IMPOSTOS), {
    timeout: GUIA_TIMEOUT_MS,
  });
  impostos.catch(() => undefined);
  try {
    await rastro.etapa('Abriu a guia da nota fiscal', async () => {
      await guia.waitForURL((url) => url.pathname === GUIA_NF, { timeout: GUIA_TIMEOUT_MS });
      await guia.locator(SALVAR).waitFor({ timeout: GUIA_TIMEOUT_MS });
    });
    await rastro.etapa('O Bling calculou os impostos da nota', async () => {
      await impostos;
      // O cálculo pode disparar outras chamadas que ainda mexem nos itens.
      await guia.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined);
    });
    const numeroNf = await rastro.etapa('Li o Número da nota', () => lerNumeroNf(guia));
    if (ensaioNf) return { arquivos: [], detalhe: `Ensaio: NF ${numeroNf} não emitida` };

    try {
      await rastro.etapa('Cliquei em Salvar', () => salvarNota(guia));
      return await enviarEBaixarNf(guia, numeroNf, dados, destDir, rastro);
    } catch (error) {
      if (error instanceof NfNaoSalva) throw error;
      // Daqui em diante a nota pode existir no Bling: reexecutar às cegas criaria outra.
      throw new Error(`NF ${numeroNf} criada, mas não autorizada/baixada — verifique no Bling`, {
        cause: error,
      });
    }
  } finally {
    await guia.close().catch(() => undefined);
    await page.bringToFront();
    await page.keyboard.press('Escape');
  }
}
