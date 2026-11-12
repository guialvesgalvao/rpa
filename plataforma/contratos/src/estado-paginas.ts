// Estado de uma lista com busca e páginas numeradas, sem dependência de framework: o site (React) e o app
// (DOM puro) aplicam o mesmo redutor. Cada página é uma requisição; as já vistas ficam em `cache` (voltar não
// refaz a requisição). `requisicao` identifica a carga em andamento: quem usa o redutor busca `pagina` sempre
// que o status vira `carregando` com um `requisicao` novo, e respostas de cargas antigas são descartadas.

export type StatusPaginas = 'carregando' | 'ocioso' | 'erro';

export type EstadoPaginas<T> = {
  busca: string;
  pagina: number;
  // Itens que casam com a busca; `null` antes da primeira resposta.
  total: number | null;
  porPagina: number;
  // Itens por número de página (chave em texto).
  cache: Record<string, T[]>;
  status: StatusPaginas;
  requisicao: number;
};

export type AcaoPaginas<T> =
  | { tipo: 'busca_alterada'; busca: string }
  | { tipo: 'pagina_escolhida'; pagina: number }
  | { tipo: 'pagina_carregada'; requisicao: number; itens: T[]; total: number }
  | { tipo: 'falhou'; requisicao: number }
  | { tipo: 'tentar_de_novo' };

export const RETICENCIAS = '…';
export type ItemPaginacao = number | typeof RETICENCIAS;

export function totalDePaginas(total: number, porPagina: number): number {
  return Math.max(1, Math.ceil(total / porPagina));
}

// A primeira carga (página 1) já nasce em andamento (`requisicao` 0).
export function estadoInicialPaginas<T>(porPagina: number, busca = ''): EstadoPaginas<T> {
  return {
    busca,
    pagina: 1,
    total: null,
    porPagina,
    cache: {},
    status: 'carregando',
    requisicao: 0,
  };
}

// Itens da página atual: vazio enquanto ela não chegou.
export function itensDaPagina<T>(estado: EstadoPaginas<T>): T[] {
  return estado.cache[String(estado.pagina)] ?? [];
}

export function redutorPaginas<T>(
  estado: EstadoPaginas<T>,
  acao: AcaoPaginas<T>,
): EstadoPaginas<T> {
  switch (acao.tipo) {
    case 'busca_alterada':
      if (acao.busca === estado.busca) return estado;
      // Busca nova: volta à página 1 e esquece as páginas da busca anterior.
      return {
        ...estado,
        busca: acao.busca,
        pagina: 1,
        total: null,
        cache: {},
        status: 'carregando',
        requisicao: estado.requisicao + 1,
      };
    case 'pagina_escolhida': {
      const limite = estado.total === null ? 1 : totalDePaginas(estado.total, estado.porPagina);
      const pagina = Math.min(Math.max(1, Math.trunc(acao.pagina)), limite);
      if (!Number.isFinite(pagina)) return estado;
      if (pagina === estado.pagina && estado.status !== 'erro') return estado;
      // Página em cache: troca na hora e descarta a carga em andamento (se houver).
      if (estado.cache[String(pagina)]) {
        return { ...estado, pagina, status: 'ocioso', requisicao: estado.requisicao + 1 };
      }
      return { ...estado, pagina, status: 'carregando', requisicao: estado.requisicao + 1 };
    }
    case 'pagina_carregada': {
      if (acao.requisicao !== estado.requisicao) return estado;
      const ultima = totalDePaginas(acao.total, estado.porPagina);
      // A lista encolheu (sincronização no meio da navegação) e a página pedida ficou além do fim: vai
      // para a última.
      if (acao.itens.length === 0 && estado.pagina > ultima) {
        return {
          ...estado,
          pagina: ultima,
          total: acao.total,
          cache: {},
          status: 'carregando',
          requisicao: estado.requisicao + 1,
        };
      }
      // Total diferente do conhecido: as outras páginas em cache podem ter deslocado.
      const cache = estado.total === null || estado.total === acao.total ? estado.cache : {};
      return {
        ...estado,
        total: acao.total,
        cache: { ...cache, [String(estado.pagina)]: acao.itens },
        status: 'ocioso',
      };
    }
    case 'falhou':
      if (acao.requisicao !== estado.requisicao) return estado;
      return { ...estado, status: 'erro' };
    case 'tentar_de_novo':
      if (estado.status !== 'erro') return estado;
      return { ...estado, status: 'carregando', requisicao: estado.requisicao + 1 };
  }
}

// Números a mostrar nos controles: a primeira, a última e a vizinhança da atual, com reticências nos
// buracos (um buraco de uma página só mostra a página no lugar das reticências).
// Ex.: atual 5 de 9 → [1, '…', 4, 5, 6, '…', 9].
export function paginasVisiveis(atual: number, totalPaginas: number): ItemPaginacao[] {
  if (totalPaginas < 1) return [];
  const pagina = Math.min(Math.max(1, atual), totalPaginas);
  const numeros = [...new Set([1, pagina - 1, pagina, pagina + 1, totalPaginas])]
    .filter((n) => n >= 1 && n <= totalPaginas)
    .sort((a, b) => a - b);

  const resultado: ItemPaginacao[] = [];
  let anterior = 0;
  for (const n of numeros) {
    if (n - anterior === 2) resultado.push(anterior + 1);
    else if (n - anterior > 2) resultado.push(RETICENCIAS);
    resultado.push(n);
    anterior = n;
  }
  return resultado;
}
