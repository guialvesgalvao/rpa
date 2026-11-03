import { getDocument, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs';

export type Margens = { esquerda: number; direita: number };

export type ResumoPdf = {
  paginas: number;
  /** Tamanho da página 1, em pontos. */
  largura: number;
  altura: number;
  /** Texto de todas as páginas, com os trechos separados por espaço. */
  texto: string;
  /** Quantas imagens são desenhadas em todas as páginas. */
  imagens: number;
};

const OPS_IMAGEM = new Set<number>([
  OPS.paintImageXObject,
  OPS.paintInlineImageXObject,
  OPS.paintImageXObjectRepeat,
]);

/** Páginas, tamanho, texto e número de imagens do PDF, para conferir o conteúdo gerado. */
export async function resumirPdf(bytes: Uint8Array): Promise<ResumoPdf> {
  const carregamento = getDocument({ data: new Uint8Array(bytes), verbosity: 0 });
  const doc = await carregamento.promise;
  try {
    const trechos: string[] = [];
    let imagens = 0;
    for (let n = 1; n <= doc.numPages; n++) {
      const pagina = await doc.getPage(n);
      for (const item of (await pagina.getTextContent()).items) {
        if ('str' in item && item.str.trim()) trechos.push(item.str);
      }
      imagens += (await pagina.getOperatorList()).fnArray.filter((op) => OPS_IMAGEM.has(op)).length;
    }
    const [x0 = 0, y0 = 0, x1 = 0, y1 = 0] = (await doc.getPage(1)).view;
    return {
      paginas: doc.numPages,
      largura: x1 - x0,
      altura: y1 - y0,
      texto: trechos.join(' '),
      imagens,
    };
  } finally {
    await carregamento.destroy();
  }
}

/**
 * Distância (em pontos) entre as bordas da página 1 e o texto mais à esquerda e mais à direita
 * dela. Serve para medir se o conteúdo ficou centralizado na folha.
 */
export async function margensHorizontais(bytes: Uint8Array): Promise<Margens> {
  const carregamento = getDocument({ data: new Uint8Array(bytes), verbosity: 0 });
  const doc = await carregamento.promise;
  try {
    const pagina = await doc.getPage(1);
    const [x0 = 0, , x1 = 0] = pagina.view;
    let menor = Infinity;
    let maior = -Infinity;
    for (const item of (await pagina.getTextContent()).items) {
      if (!('str' in item) || !item.str.trim()) continue;
      const x = Number(item.transform[4]);
      menor = Math.min(menor, x);
      maior = Math.max(maior, x + item.width);
    }
    if (menor === Infinity) throw new Error('A página 1 do PDF não tem texto');
    return { esquerda: menor - x0, direita: x1 - maior };
  } finally {
    await carregamento.destroy();
  }
}
