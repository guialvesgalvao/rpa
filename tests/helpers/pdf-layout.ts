import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

export type Margens = { esquerda: number; direita: number };

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
