// Cliente final de revenda (ADR 0017): o pedido do Bling sai em nome do revendedor e traz, no "Nome" do
// endereço de entrega, para quem a arte é feita. Guardado como texto na tarefa e na arte (não é um cliente da base).

export const CLIENTE_FINAL_MAX = 120;

// Como foi digitado, sem espaços nas pontas nem repetidos; vazio vira `null`.
export function limparClienteFinal(texto: string | null | undefined): string | null {
  const limpo = (texto ?? '').replace(/\s+/g, ' ').trim();
  return limpo || null;
}

// Chave de comparação, sem acentos nem maiúsculas: "Pizzaria  Fictícia" = "pizzaria ficticia". A coluna gerada
// `cliente_final_chave` do banco usa a mesma regra.
export const chaveClienteFinal = (texto: string): string =>
  texto.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();

// Mesmas regras no site, no app e na API; `null` = válido (o campo é opcional).
export function validarClienteFinal(texto: string | null | undefined): string | null {
  const limpo = limparClienteFinal(texto);
  if (limpo && limpo.length > CLIENTE_FINAL_MAX) {
    return `O cliente final pode ter no máximo ${CLIENTE_FINAL_MAX} caracteres.`;
  }
  return null;
}

// Cliente final de um pedido: o "Nome" do endereço de entrega, a não ser que esteja vazio ou seja o próprio
// cliente (razão social ou nome fantasia, sem acento nem maiúsculas). Texto longo é cortado no limite.
export function clienteFinalDoPedido(
  nomeEntrega: string | null | undefined,
  cliente: { razaoSocial: string; nomeFantasia: string | null },
): string | null {
  const limpo = limparClienteFinal(nomeEntrega);
  if (!limpo) return null;
  const chave = chaveClienteFinal(limpo);
  const doCliente = [cliente.razaoSocial, cliente.nomeFantasia]
    .filter((nome): nome is string => !!nome)
    .map(chaveClienteFinal);
  if (doCliente.includes(chave)) return null;
  return limpo.slice(0, CLIENTE_FINAL_MAX).trim();
}

// Selo da arte no perfil do cliente: "Cliente final: Pizzaria Ficticia · Pedido nº 334"; `null` sem cliente final.
export function seloClienteFinal(arte: {
  clienteFinal: string | null;
  pedidoNumero: string | null;
}): string | null {
  if (!arte.clienteFinal) return null;
  const pedido = arte.pedidoNumero ? ` · Pedido nº ${arte.pedidoNumero}` : '';
  return `Cliente final: ${arte.clienteFinal}${pedido}`;
}

// Opções do filtro por cliente final das artes de um produto: "Todos", cada cliente final (sem repetir pela
// chave, na ordem alfabética) e "Sem cliente final" quando há arte sem ele. Vazio quando nenhuma arte tem
// cliente final (o filtro não aparece).
export const FILTRO_CLIENTE_FINAL_TODOS = '';
export const FILTRO_SEM_CLIENTE_FINAL = '__sem__';

export type OpcaoFiltroClienteFinal = { valor: string; rotulo: string };

export function opcoesFiltroClienteFinal(
  artes: readonly { clienteFinal: string | null }[],
): OpcaoFiltroClienteFinal[] {
  const porChave = new Map<string, string>();
  let temSem = false;
  for (const { clienteFinal } of artes) {
    if (!clienteFinal) {
      temSem = true;
      continue;
    }
    const chave = chaveClienteFinal(clienteFinal);
    if (!porChave.has(chave)) porChave.set(chave, clienteFinal);
  }
  if (porChave.size === 0) return [];
  const finais = [...porChave.entries()]
    .sort(([a], [b]) => a.localeCompare(b, 'pt-BR'))
    .map(([chave, rotulo]) => ({ valor: chave, rotulo }));
  return [
    { valor: FILTRO_CLIENTE_FINAL_TODOS, rotulo: 'Todos os clientes finais' },
    ...finais,
    ...(temSem ? [{ valor: FILTRO_SEM_CLIENTE_FINAL, rotulo: 'Sem cliente final' }] : []),
  ];
}

export function filtrarPorClienteFinal<T extends { clienteFinal: string | null }>(
  artes: readonly T[],
  valor: string,
): T[] {
  if (valor === FILTRO_CLIENTE_FINAL_TODOS) return [...artes];
  if (valor === FILTRO_SEM_CLIENTE_FINAL) return artes.filter((arte) => !arte.clienteFinal);
  return artes.filter(
    (arte) => arte.clienteFinal !== null && chaveClienteFinal(arte.clienteFinal) === valor,
  );
}
