import { writeFile } from 'node:fs/promises';
import path from 'node:path';

import { ensureDir } from '../../utils/fs.js';
import { separarPaginas } from '../../utils/pdf.js';
import type { ContextoDoc, SaidaDoc } from './documentos.js';
import {
  abrirNovaGuia,
  baixarPdfDaGuia,
  buscarPedido,
  clicarNoMenu,
  ItemDeMenuAusente,
} from './guia.js';
import { caminhoLivre, nomeBoleto } from './nomes.js';
import type { DadosPedido } from './pedido.js';

const MENU_ITEM = 'Emitir boletos';
/** O Bling oculta "Emitir boletos" se o pedido tem nota e nenhuma conta lançada (Task 2). */
const INDISPONIVEL =
  'Emitir boletos indisponível no Bling: o pedido já possui nota sem contas lançadas — verifique no Bling';

/**
 * Nome de cada página do boleto: a página i é a parcela i. Lança erro se o número de páginas
 * não bater com o de parcelas, para não salvar boleto com vencimento trocado.
 */
export function nomesDoBoleto(totalPaginas: number, { cliente, parcelas }: DadosPedido): string[] {
  if (totalPaginas !== parcelas.length) {
    throw new Error(`Boleto com ${totalPaginas} páginas, pedido com ${parcelas.length} parcelas`);
  }
  return parcelas.map((vencimento) => nomeBoleto(cliente, vencimento));
}

/**
 * Busca o pedido na listagem de vendas (já aberta), aciona "⋮ → Emitir boletos" e salva um PDF
 * por parcela em destDir. "Emitir boletos" lança as contas a receber do pedido no Bling.
 */
export async function gerarBoleto({
  page,
  numero,
  dados,
  destDir,
  rastro,
}: ContextoDoc): Promise<SaidaDoc> {
  const row = await rastro.etapa(`Busquei o pedido ${numero} na listagem`, () =>
    buscarPedido(page, numero),
  );
  const boleto = await rastro.etapa(`Abri o menu ⋮ e cliquei em ${MENU_ITEM}`, () =>
    abrirNovaGuia(page, () =>
      clicarNoMenu(row, MENU_ITEM).catch((error: unknown) => {
        throw error instanceof ItemDeMenuAusente ? new Error(INDISPONIVEL) : error;
      }),
    ),
  );
  try {
    const pdf = await rastro.etapa('Baixei o PDF da nova guia', () => baixarPdfDaGuia(boleto));
    const { paginas, nomes } = await rastro.etapa('Separei o PDF por parcela', async () => {
      const paginas = await separarPaginas(pdf);
      return { paginas, nomes: nomesDoBoleto(paginas.length, dados) };
    });
    const dir = await ensureDir(destDir);
    const arquivos: string[] = [];
    for (const [i, pagina] of paginas.entries()) {
      const destino = await caminhoLivre(dir, nomes[i]!);
      // 'wx': nunca sobrescreve um arquivo existente.
      await rastro.etapa(`Salvei ${path.basename(destino)}`, () =>
        writeFile(destino, pagina, { flag: 'wx' }),
      );
      arquivos.push(destino);
    }
    return { arquivos };
  } finally {
    await boleto.close().catch(() => undefined);
    await page.bringToFront();
    await page.keyboard.press('Escape');
  }
}
