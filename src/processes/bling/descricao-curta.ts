import type { Page } from 'playwright';
import { z } from 'zod';

/**
 * "Descrição curta" do cadastro do produto no Bling, que sai como "Formato" na OP (ADR 0016). Vem da
 * API v3 chamada pela sessão web do robô, já logada (`/Api/v3/produtos/{id}` → `data.descricaoCurta`),
 * sem o OAuth da plataforma. O campo é editado num editor rich text, então chega em HTML.
 */

const esquema = z.object({
  data: z.object({ descricaoCurta: z.string().nullish() }),
});

/** Entidades nomeadas comuns em textos em português (o editor do Bling pode gravar `&aacute;`). */
const ENTIDADES: Record<string, string> = {
  nbsp: ' ',
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  ordm: 'º',
  ordf: 'ª',
  deg: '°',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  laquo: '«',
  raquo: '»',
  ldquo: '“',
  rdquo: '”',
  lsquo: '‘',
  rsquo: '’',
  times: '×',
  middot: '·',
  bull: '•',
  sup2: '²',
  sup3: '³',
  frac12: '½',
  frac14: '¼',
  frac34: '¾',
};
const ACENTOS: Record<string, string> = {
  aacute: 'á',
  eacute: 'é',
  iacute: 'í',
  oacute: 'ó',
  uacute: 'ú',
  agrave: 'à',
  acirc: 'â',
  ecirc: 'ê',
  ocirc: 'ô',
  atilde: 'ã',
  otilde: 'õ',
  ccedil: 'ç',
  uuml: 'ü',
};
for (const [nome, letra] of Object.entries(ACENTOS)) {
  ENTIDADES[nome] = letra;
  ENTIDADES[nome[0]!.toUpperCase() + nome.slice(1)] = letra.toUpperCase();
}

function decodificarEntidades(texto: string): string {
  return texto.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (original, corpo: string) => {
    if (corpo[0] === '#') {
      const codigo =
        corpo[1] === 'x' || corpo[1] === 'X'
          ? Number.parseInt(corpo.slice(2), 16)
          : Number.parseInt(corpo.slice(1), 10);
      return Number.isInteger(codigo) && codigo > 0 && codigo <= 0x10ffff
        ? String.fromCodePoint(codigo)
        : original;
    }
    return ENTIDADES[corpo] ?? original;
  });
}

/**
 * HTML do editor → texto para a OP: `<br>` e o fim de parágrafos, blocos e itens de lista viram quebra
 * de linha; as demais tags saem; as entidades são decodificadas depois (então `&lt;b&gt;` vira texto).
 * Espaços sobrando e linhas vazias em excesso saem; só espaços = vazio.
 */
export function textoDaDescricao(html: string): string {
  const semTags = html
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '- ')
    .replace(/<\/(p|div|li|h[1-6]|tr|ul|ol|blockquote)\s*>/gi, '\n')
    .replace(/<[^>]*>/g, '');
  return decodificarEntidades(semTags)
    .replace(/\r\n?/g, '\n')
    .replaceAll(String.fromCharCode(0xa0), ' ')
    .split('\n')
    .map((linha) => linha.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Página do Bling já logada; só o `evaluate` é usado (os testes passam uma página falsa). */
export type PaginaBling = Pick<Page, 'evaluate'>;

/** Lê a Descrição curta já convertida em texto; `undefined` quando o produto não tem descrição. */
export async function lerDescricaoCurta(
  page: PaginaBling,
  idProduto: string,
): Promise<string | undefined> {
  if (!/^\d+$/.test(idProduto)) throw new Error(`Id de produto do Bling inválido: ${idProduto}`);
  const resposta = await page.evaluate(async (id: string) => {
    const r = await fetch(`/Api/v3/produtos/${id}`, { headers: { accept: 'application/json' } });
    return { status: r.status, corpo: r.ok ? await r.text() : '' };
  }, idProduto);
  if (resposta.status !== 200) {
    throw new Error(`O Bling respondeu ${resposta.status} ao ler o produto ${idProduto}`);
  }
  let json: unknown;
  try {
    json = JSON.parse(resposta.corpo);
  } catch {
    throw new Error(`Resposta do produto ${idProduto} não é JSON`);
  }
  const parsed = esquema.safeParse(json);
  if (!parsed.success) throw new Error(`Produto ${idProduto} em formato inesperado`);
  return textoDaDescricao(parsed.data.data.descricaoCurta ?? '') || undefined;
}

/** Executa `fn` para cada item com no máximo `limite` chamadas ao mesmo tempo. */
export async function emParalelo<T>(
  itens: readonly T[],
  limite: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  let proximo = 0;
  const trabalhador = async () => {
    while (proximo < itens.length) {
      const item = itens[proximo++]!;
      await fn(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limite, itens.length) }, trabalhador));
}
