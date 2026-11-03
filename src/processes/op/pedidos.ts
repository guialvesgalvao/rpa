import path from 'node:path';

import type { Config } from '../../config/env.js';
import { withBrowser } from '../../core/browser.js';
import type { Logger } from '../../core/logger.js';
import { criarRastro, primeiraLinha, type Passo, type Rastro } from '../../core/rastro.js';
import { ensureDir, timestampedName } from '../../utils/fs.js';
import { prepararListagem } from '../bling/documentos.js';
import { fonteBling, fonteMock, type PedidoOp } from '../bling/pedido-op.js';

/** Pedido lido para a OP, ou o erro (com o passo a passo) que impediu a leitura dele. */
export type PedidoLido =
  { numero: string; pedido: PedidoOp } | { numero: string; erro: string; passos: Passo[] };

/** Lê um pedido; `rastro` registra o passo a passo mostrado ao usuário. */
export type LerPedido = (numero: string, rastro: Rastro) => Promise<PedidoOp>;

/**
 * Lê os pedidos um por vez. A falha de um vira erro só dele, e os demais seguem; `onFalha` roda
 * antes do próximo (ex.: screenshot).
 */
export async function lerPedidos(
  numeros: readonly string[],
  ler: LerPedido,
  onFalha?: (numero: string, error: unknown) => Promise<void>,
): Promise<PedidoLido[]> {
  const lidos: PedidoLido[] = [];
  for (const numero of numeros) {
    const rastro = criarRastro();
    try {
      lidos.push({ numero, pedido: await ler(numero, rastro) });
    } catch (error) {
      lidos.push({ numero, erro: primeiraLinha(error), passos: rastro.passos });
      await onFalha?.(numero, error);
    }
  }
  return lidos;
}

/** Pedidos da fixture sintética (`RPA_OP_MOCK=1`), sem abrir o Bling. */
export function lerPedidosMock(
  numeros: readonly string[],
  caminho?: string,
): Promise<PedidoLido[]> {
  const fonte = fonteMock(caminho);
  return lerPedidos(numeros, (numero) => fonte(numero));
}

/** Abre o Bling (navegador visível, como a Fatura) e lê cada pedido pelo `obterVenda`. */
export function lerPedidosBling(
  config: Config,
  logger: Logger,
  numeros: readonly string[],
): Promise<PedidoLido[]> {
  return withBrowser({ ...config, headless: false }, logger, async ({ page }) => {
    await prepararListagem(page, config, logger);
    return lerPedidos(
      numeros,
      (numero, rastro) => fonteBling(page, rastro)(numero),
      async (numero, error) => {
        const screenshot = path.join(
          await ensureDir(config.artifactsDir),
          timestampedName(`erro-op-pedido-${numero}`, '.png'),
        );
        await page.screenshot({ path: screenshot }).catch(() => undefined);
        logger.error({ numero, err: error, screenshot }, 'Falha ao ler o pedido para a OP');
        await page.keyboard.press('Escape').catch(() => undefined);
      },
    );
  });
}
