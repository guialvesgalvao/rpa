import type { Dialog, Locator, Page } from 'playwright';

import { VENDAS_URL } from './session.js';

/** Campo "Pesquisar por nome, e-mail, CPF/CNPJ ou n° do pedido" da listagem. */
export const SEARCH_INPUT = '#pesquisa-mini';
/** API interna que a tela usa para carregar a listagem de vendas. */
const LIST_API = '/Api/v3/vendasinternal/list';
const GUIA_TIMEOUT_MS = 30_000;

/** Linha da listagem (de vendas ou de notas) cujo Número (2ª coluna) é exatamente `numero`. */
export function linhaPorNumero(page: Page, numero: string): Locator {
  return page
    .locator('tbody tr:visible')
    .filter({ has: page.locator('td:nth-child(2)').getByText(numero, { exact: true }) });
}

/**
 * Executa uma ação que recarrega a listagem (busca, limpar filtro) e espera a resposta da
 * API interna da lista, para não interagir com linhas que ainda serão re-renderizadas.
 */
export async function aguardarLista(page: Page, acao: () => Promise<void>): Promise<void> {
  const carregou = page.waitForResponse((r) => r.url().includes(LIST_API), { timeout: 15_000 });
  await acao();
  await carregou;
  await page.waitForLoadState('domcontentloaded');
}

/** Busca o pedido pelo Número na listagem de vendas (já aberta) e devolve a linha dele. */
export async function buscarPedido(page: Page, numero: string): Promise<Locator> {
  const search = page.locator(SEARCH_INPUT);
  await search.fill(numero);
  await aguardarLista(page, () => search.press('Enter'));

  const row = linhaPorNumero(page, numero);
  await row
    .first()
    .waitFor({ timeout: 15_000 })
    .catch(() => {
      throw new Error(`Pedido ${numero} não encontrado na listagem de vendas.`);
    });
  const count = await row.count();
  if (count > 1) throw new Error(`Mais de um pedido com número ${numero} (${count}).`);
  return row;
}

/** O menu ⋮ abriu, mas sem o item pedido (o Bling oculta itens conforme o estado do pedido). */
export class ItemDeMenuAusente extends Error {
  constructor(readonly rotulo: string) {
    super(`Item "${rotulo}" ausente no menu ⋮`);
  }
}

/**
 * Abre o menu ⋮ da linha e clica no item com o texto exato `rotulo`. Lança `ItemDeMenuAusente`
 * se o menu estiver aberto e o item não existir nele.
 */
export async function clicarNoMenu(row: Locator, rotulo: string): Promise<void> {
  const toggle = row.locator('td.context-menu-item button.dropdown-toggle');
  const menu = row.locator('ul.dropdown-menu');
  const item = menu.getByText(rotulo, { exact: true });
  // O menu às vezes fecha sozinho logo após abrir (re-render da linha); tenta mais uma vez.
  for (let tentativa = 1; ; tentativa++) {
    await toggle.click();
    try {
      await item.click({ timeout: 5_000 });
      return;
    } catch (error) {
      const menuAberto = (await menu.locator('li').filter({ visible: true }).count()) > 0;
      if (menuAberto && !(await item.count())) throw new ItemDeMenuAusente(rotulo);
      if (tentativa >= 2) throw error;
    }
  }
}

/** Remove o filtro padrão de situação ("Em aberto") para achar pedidos em qualquer situação. */
export async function limparFiltroSituacao(page: Page): Promise<void> {
  // O indicador de filtros só aparece depois da primeira carga da lista.
  const limpar = page.getByText('Limpar', { exact: true }).filter({ visible: true });
  await limpar
    .or(page.getByText('Nenhum filtro aplicado', { exact: true }))
    .first()
    .waitFor({ timeout: 15_000 })
    .catch(() => undefined);
  if (await limpar.count()) await aguardarLista(page, () => limpar.first().click());
}

/**
 * Sai da tela de edição do pedido sem salvar e deixa a listagem pronta para nova busca.
 * Nada foi alterado no pedido, então um eventual aviso de saída é aceito.
 */
export async function voltarParaListagem(page: Page): Promise<void> {
  const aceitar = (dialog: Dialog) => void dialog.accept().catch(() => undefined);
  page.on('dialog', aceitar);
  try {
    await page.goto(VENDAS_URL, { waitUntil: 'load' });
  } finally {
    page.off('dialog', aceitar);
  }
  await page.locator(SEARCH_INPUT).waitFor();
  await limparFiltroSituacao(page);
}

/** Executa `acao` e devolve a guia que ela abriu. A espera começa antes, para não perder o evento. */
export async function abrirNovaGuia(page: Page, acao: () => Promise<void>): Promise<Page> {
  const novaGuia = page.context().waitForEvent('page', { timeout: GUIA_TIMEOUT_MS });
  // Se a ação falhar, a espera pela guia não fica como rejeição sem tratamento.
  novaGuia.catch(() => undefined);
  await acao();
  return novaGuia;
}

/** Marca que o init script põe na guia quando ela chama window.print(): sinal de que está pronta. */
const PRINT_SOLICITADO = '__rpaPrintSolicitado';
const IMPRESSAO_TIMEOUT_MS = 30_000;

/**
 * As guias de impressão do Bling (recibo, DANFE) chamam window.print() quando terminam de
 * carregar. Troca, nas guias abertas daqui em diante, por uma função que só marca a chamada:
 * evita o diálogo de impressão do Chrome e diz quando o conteúdo está pronto. Chame `dispose()`
 * no fim.
 */
export function interceptarImpressao(page: Page) {
  return page.context().addInitScript((marca) => {
    window.print = () => void Reflect.set(window, marca, true);
  }, PRINT_SOLICITADO);
}

/** Ajuste da conversão de uma guia em PDF. Sem ajuste, o PDF sai como A4 sem margens. */
export type AjustePdf = {
  /** CSS injetado na guia antes de gerar o PDF. */
  css?: string;
};

/** Salva a página (já pronta) como PDF A4, aplicando o `ajuste`, e confere que saiu um PDF. */
export async function salvarComoPdf(
  pagina: Page,
  documento: string,
  ajuste: AjustePdf = {},
): Promise<Buffer> {
  if (ajuste.css) await pagina.addStyleTag({ content: ajuste.css });
  const bytes = await pagina.pdf({ format: 'A4', printBackground: true });
  if (bytes.subarray(0, 4).toString('latin1') !== '%PDF') {
    throw new Error(`O Chrome não gerou um PDF do ${documento}`);
  }
  return bytes;
}

/**
 * Espera a guia de impressão aberta com `interceptarImpressao` pedir a impressão, confere que é
 * a página esperada (`urlEsperada`) e com conteúdo, e a salva como PDF A4 (ver `salvarComoPdf`).
 */
export async function pdfDaGuiaImpressa(
  guia: Page,
  urlEsperada: string,
  documento: string,
  ajuste?: AjustePdf,
): Promise<Buffer> {
  // 'load' sozinho não basta: a guia nasce em about:blank e o PDF sairia em branco.
  await guia.waitForFunction((marca) => Reflect.get(window, marca) === true, PRINT_SOLICITADO, {
    timeout: IMPRESSAO_TIMEOUT_MS,
  });
  if (!guia.url().includes(urlEsperada)) {
    throw new Error(`A nova guia não é o ${documento} (${new URL(guia.url()).pathname})`);
  }
  if (!(await guia.locator('body').innerText()).trim()) {
    throw new Error(`A guia do ${documento} abriu sem conteúdo`);
  }
  return salvarComoPdf(guia, documento, ajuste);
}

/**
 * O Bling abre o PDF numa nova guia (visualizador de PDF do Chrome). Baixamos o PDF pela
 * URL dessa guia com `context.request`, que usa os cookies da sessão.
 */
export async function baixarPdfDaGuia(guia: Page): Promise<Buffer> {
  await guia.waitForURL((url) => url.protocol.startsWith('http'), { timeout: GUIA_TIMEOUT_MS });
  const response = await guia.context().request.get(guia.url(), { timeout: GUIA_TIMEOUT_MS });
  const body = await response.body();
  if (!response.ok() || body.subarray(0, 4).toString('latin1') !== '%PDF') {
    throw new Error(`O Bling não devolveu um PDF na nova guia (HTTP ${response.status()}).`);
  }
  return body;
}
