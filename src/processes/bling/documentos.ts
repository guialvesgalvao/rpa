import path from 'node:path';
import type { Page } from 'playwright';

import type { Config } from '../../config/env.js';
import { withBrowser } from '../../core/browser.js';
import type { Logger } from '../../core/logger.js';
import { criarRastro, primeiraLinha, type Passo, type Rastro } from '../../core/rastro.js';
import { ensureDir, timestampedName } from '../../utils/fs.js';
import { gerarBoleto } from './boleto.js';
import { limparFiltroSituacao, SEARCH_INPUT } from './guia.js';
import { gerarNf } from './nota-fiscal.js';
import { type DadosPedido, lerDadosPedido } from './pedido.js';
import { gerarRecibo } from './recibo.js';
import { type DocTipo, type PedidoSelecao, TODOS_DOCS } from './selecao.js';
import { openVendas } from './session.js';

export type DocStatus = 'pendente' | 'processando' | 'ok' | 'erro';

export type DocResult = {
  numero: string;
  doc: DocTipo;
  status: DocStatus;
  arquivos?: string[];
  detalhe?: string;
  erro?: string;
  passos?: Passo[];
};

/** O que um gerador entrega quando o documento sai com sucesso. */
export type SaidaDoc = { arquivos: string[]; detalhe?: string };

/** Gerador de um documento, como o laço de `executarSelecao` o chama. */
export type GeradorDoc<D> = (ctx: {
  numero: string;
  dados: D;
  rastro: Rastro;
}) => Promise<SaidaDoc>;

/** Contexto dos geradores que rodam no navegador. */
export type ContextoDoc = {
  page: Page;
  numero: string;
  dados: DadosPedido;
  destDir: string;
  rastro: Rastro;
  /** Só a NF usa: para antes de Salvar, sem criar nem emitir nada (CLI `--ensaio-nf`). */
  ensaioNf: boolean;
};

/** Ordem fixa de execução dos documentos de um pedido. */
const ORDEM_DOCS: DocTipo[] = ['boleto', 'recibo', 'nf'];

type GeradorNavegador = (ctx: ContextoDoc) => Promise<SaidaDoc>;

/** Geradores já disponíveis; doc sem gerador vira erro "Documento ainda não disponível". */
const GERADORES: Partial<Record<DocTipo, GeradorNavegador>> = {
  boleto: gerarBoleto,
  recibo: gerarRecibo,
  nf: gerarNf,
};

/** Documentos com gerador pronto, na ordem fixa; os outros aparecem no app como "em breve". */
export const DOCS_DISPONIVEIS: DocTipo[] = TODOS_DOCS.filter((doc) => GERADORES[doc]);

export type Falha = { numero: string; etapa: DocTipo | 'pedido'; error: unknown };

export type ExecutarSelecaoOptions<D> = {
  /** Trabalho comum aos documentos do pedido (ex.: ler os dados dele). Se falhar, todos falham. */
  prepararPedido: (numero: string, rastro: Rastro) => Promise<D>;
  geradores: Partial<Record<DocTipo, GeradorDoc<D>>>;
  onProgress?: (item: DocResult) => void;
  /** Chamado a cada falha, antes de seguir (ex.: screenshot e voltar à listagem). */
  onFalha?: (falha: Falha) => Promise<void>;
};

/**
 * Processa a seleção pedido a pedido e, em cada um, os documentos na ordem boleto → recibo → nf.
 * A falha de um documento não interrompe os demais; só a falha em `prepararPedido` faz todos os
 * documentos do pedido falharem. O rastro de cada documento começa com os passos do pedido.
 */
export async function executarSelecao<D>(
  selecao: PedidoSelecao[],
  options: ExecutarSelecaoOptions<D>,
): Promise<DocResult[]> {
  const { prepararPedido, geradores, onProgress, onFalha } = options;
  const results: DocResult[] = [];

  for (const { numero, docs } of selecao) {
    const ordenados = ORDEM_DOCS.filter((doc) => docs.includes(doc));
    if (!ordenados.length) continue;
    const inicio = results.length;
    results.push(...ordenados.map((doc): DocResult => ({ numero, doc, status: 'pendente' })));
    const atualizar = (index: number, patch: Partial<DocResult>) => {
      const item = { ...results[inicio + index]!, ...patch };
      results[inicio + index] = item;
      onProgress?.(item);
    };

    // A preparação conta como início do primeiro documento.
    atualizar(0, { status: 'processando' });
    const rastroPedido = criarRastro();
    let dados: D;
    try {
      dados = await prepararPedido(numero, rastroPedido);
    } catch (error) {
      const erro = primeiraLinha(error);
      ordenados.forEach((_, index) =>
        atualizar(index, { status: 'erro', erro, passos: [...rastroPedido.passos] }),
      );
      await onFalha?.({ numero, etapa: 'pedido', error });
      continue;
    }

    for (const [index, doc] of ordenados.entries()) {
      const gerador = geradores[doc];
      if (!gerador) {
        atualizar(index, { status: 'erro', erro: 'Documento ainda não disponível' });
        continue;
      }
      if (index > 0) atualizar(index, { status: 'processando' });
      const rastro = criarRastro(rastroPedido.passos);
      try {
        const saida = await gerador({ numero, dados, rastro });
        atualizar(index, { status: 'ok', ...saida, passos: rastro.passos });
      } catch (error) {
        atualizar(index, { status: 'erro', erro: primeiraLinha(error), passos: rastro.passos });
        await onFalha?.({ numero, etapa: doc, error });
      }
    }
  }
  return results;
}

/** Alerta que às vezes aparece após o login e tapa a listagem (achado da Task 2). */
const ALERTA_FORMAS_PAGAMENTO = 'Unknown Function getFormasPagamento';

/** Deixa a listagem de vendas pronta para buscar pedidos em qualquer situação. */
async function prepararListagem(page: Page, config: Config, logger: Logger): Promise<void> {
  await openVendas(page, config, logger);
  const alerta = page.getByText(ALERTA_FORMAS_PAGAMENTO).filter({ visible: true });
  await page.locator(SEARCH_INPUT).or(alerta).first().waitFor();
  if (await alerta.count()) {
    logger.warn('Alerta "getFormasPagamento" sobre a listagem; fechando e recarregando');
    await page.getByRole('button', { name: 'Ok', exact: true }).filter({ visible: true }).click();
    await page.reload({ waitUntil: 'load' });
  }
  await page.locator(SEARCH_INPUT).waitFor();
  await limparFiltroSituacao(page);
}

export type GerarDocumentosOptions = {
  config: Config;
  logger: Logger;
  selecao: PedidoSelecao[];
  destDir: string;
  /** NF em ensaio: abre o formulário, lê o número e fecha sem salvar. O app nunca usa. */
  ensaioNf?: boolean;
  onProgress?: (item: DocResult) => void;
};

/**
 * Gera os documentos selecionados de cada pedido, um por vez, no navegador (sempre visível).
 * Cada falha fica no resultado, com o passo a passo e um screenshot em artifacts/.
 */
export async function gerarDocumentos(options: GerarDocumentosOptions): Promise<DocResult[]> {
  const { config, logger, selecao, destDir, ensaioNf = false, onProgress } = options;

  return withBrowser({ ...config, headless: false }, logger, async ({ page }) => {
    await prepararListagem(page, config, logger);

    const geradores: Partial<Record<DocTipo, GeradorDoc<DadosPedido>>> = {};
    for (const [doc, gerar] of Object.entries(GERADORES) as [DocTipo, GeradorNavegador][]) {
      geradores[doc] = ({ numero, dados, rastro }) =>
        gerar({ page, numero, dados, destDir, rastro, ensaioNf });
    }

    return executarSelecao(selecao, {
      prepararPedido: (numero, rastro) => lerDadosPedido(page, numero, rastro),
      geradores,
      onProgress: (item) => {
        if (item.status === 'ok') {
          const { numero, doc, arquivos, detalhe } = item;
          logger.info({ numero, doc, arquivos, detalhe }, 'Documento salvo');
        }
        onProgress?.(item);
      },
      onFalha: async ({ numero, etapa, error }) => {
        const screenshot = path.join(
          await ensureDir(config.artifactsDir),
          timestampedName(`erro-pedido-${numero}-${etapa}`, '.png'),
        );
        await page.screenshot({ path: screenshot }).catch(() => undefined);
        logger.error({ numero, etapa, err: error, screenshot }, 'Falha ao gerar documento');
        await page.keyboard.press('Escape').catch(() => undefined);
      },
    });
  });
}
