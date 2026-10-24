import { defineProcess } from '../../core/process.js';
import { DOCS_DISPONIVEIS, gerarDocumentos } from './documentos.js';
import { parseNumeros } from './numeros.js';
import { parseDocs } from './selecao.js';

const DOCS_FLAG = '--docs=';
const ENSAIO_NF_FLAG = '--ensaio-nf';

/**
 * Fluxo do Bling (POC): salva os documentos (PDF) dos pedidos informados.
 * Uso: npm run process -- bling <número> [número...] [--docs=boleto,recibo,nf] [--ensaio-nf]
 * Sem `--docs`, gera boleto e recibo. Os PDFs vão para BLING_BOLETOS_DIR. `--ensaio-nf` abre a
 * NF e para antes de Salvar (não cria nem emite nada). Para uso sem terminal, ver `npm run app`.
 */
export default defineProcess({
  name: 'bling',
  description: 'Salva boleto, recibo e/ou NF (PDF) dos pedidos informados (POC)',
  async run({ config, logger, args }) {
    const flags = args.filter((arg) => arg.startsWith(DOCS_FLAG));
    if (flags.length > 1) throw new Error('Informe --docs uma vez só.');
    const docs = parseDocs(flags[0]?.slice(DOCS_FLAG.length), DOCS_DISPONIVEIS);
    const ensaioNf = args.includes(ENSAIO_NF_FLAG);
    if (ensaioNf && !docs.includes('nf')) throw new Error('--ensaio-nf exige nf em --docs.');

    const numeros = args.filter((arg) => !arg.startsWith(DOCS_FLAG) && arg !== ENSAIO_NF_FLAG);
    const { validos, invalidos } = parseNumeros(numeros.join(' '));
    if (invalidos.length) logger.warn({ invalidos }, 'Entradas ignoradas (não são números)');
    if (!validos.length) throw new Error('Informe ao menos um número de pedido.');

    const results = await gerarDocumentos({
      config,
      logger,
      selecao: validos.map((numero) => ({ numero, docs })),
      destDir: config.bling.boletosDir,
      ensaioNf,
    });
    const falhas = results.filter((r) => r.status === 'erro');
    for (const falha of falhas) {
      logger.error({ numero: falha.numero, doc: falha.doc, passos: falha.passos }, falha.erro);
    }
    logger.info(
      { total: results.length, ok: results.length - falhas.length, falhas: falhas.length },
      'Resumo',
    );
    if (falhas.length) throw new Error(`${falhas.length} documento(s) com erro.`);
  },
});
