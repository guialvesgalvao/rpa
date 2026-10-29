// Estado de uma lista com busca e paginação por cursor, sem dependência de framework: o site (React) e o app
// (DOM puro) aplicam o mesmo redutor. `requisicao` identifica a carga em andamento; respostas de cargas
// antigas (busca trocada, tentativa nova) são descartadas.

export type StatusLista = 'carregando' | 'ocioso' | 'erro';

export type EstadoLista<T> = {
  busca: string;
  itens: T[];
  proximoCursor: string | null;
  status: StatusLista;
  requisicao: number;
  // `true` depois que a API devolveu a última página (cursor `null`).
  fim: boolean;
};

export type AcaoLista<T> =
  | { tipo: 'busca_alterada'; busca: string }
  | { tipo: 'carregar_mais' }
  | { tipo: 'tentar_de_novo' }
  | { tipo: 'pagina_carregada'; requisicao: number; itens: T[]; proximoCursor: string | null }
  | { tipo: 'falhou'; requisicao: number };

// A primeira carga já nasce em andamento (`requisicao` 0).
export function estadoInicial<T>(busca = ''): EstadoLista<T> {
  return { busca, itens: [], proximoCursor: null, status: 'carregando', requisicao: 0, fim: false };
}

export function redutorLista<T>(estado: EstadoLista<T>, acao: AcaoLista<T>): EstadoLista<T> {
  switch (acao.tipo) {
    case 'busca_alterada':
      if (acao.busca === estado.busca) return estado;
      // Busca nova: descarta as páginas antigas e recomeça sem cursor.
      return {
        busca: acao.busca,
        itens: [],
        proximoCursor: null,
        status: 'carregando',
        requisicao: estado.requisicao + 1,
        fim: false,
      };
    case 'carregar_mais':
      if (estado.status !== 'ocioso' || estado.fim) return estado;
      return { ...estado, status: 'carregando', requisicao: estado.requisicao + 1 };
    case 'tentar_de_novo':
      if (estado.status !== 'erro') return estado;
      return { ...estado, status: 'carregando', requisicao: estado.requisicao + 1 };
    case 'pagina_carregada':
      if (acao.requisicao !== estado.requisicao) return estado;
      return {
        ...estado,
        itens: [...estado.itens, ...acao.itens],
        proximoCursor: acao.proximoCursor,
        status: 'ocioso',
        fim: acao.proximoCursor === null,
      };
    case 'falhou':
      if (acao.requisicao !== estado.requisicao) return estado;
      return { ...estado, status: 'erro' };
  }
}
