// Cache das cores no servidor do site (`fetch` do Next com tag). A lista muda pouco: 1 h, e o proxy invalida a
// tag logo depois de uma cor criada pela tela (`POST /v1/cores`). A chave do cache do `fetch` inclui os
// cabeçalhos, então cada token de acesso tem a própria entrada; a lista é a mesma para todos.
export const TAG_CORES = 'cores';
export const CACHE_CORES = { revalidate: 3600, tags: [TAG_CORES] };

export type CacheLeitura = typeof CACHE_CORES;

export const criouCor = (metodo: string, caminho: string, status: number): boolean =>
  metodo === 'POST' && caminho === '/v1/cores' && status === 201;
