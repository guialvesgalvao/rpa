// Nomes dos clientes fictícios do `semear` da plataforma (`gerarCliente` em
// plataforma/api/src/cli/semear-dev.ts), para os cenários acharem clientes conhecidos sem depender da ordem.

const RAMOS = ['Padaria', 'Confeitaria', 'Pizzaria', 'Lanchonete', 'Mercearia', 'Doceria'];
const NOMES = [
  'São João',
  'Pão Quente',
  'Açaí Tropical',
  'Ouro Verde',
  'Estrela do Sul',
  'Beira-Mar',
];

export const CLIENTES_POR_EMPRESA = 60;
/** O seed só dá artes aos 15 primeiros clientes (por CNPJ); do 16º em diante, nenhum tem arte. */
export const PRIMEIRO_SEM_ARTE = 15;

// Evite os índices 30 a 35 ("Beira-Mar") em buscas com o número: com dígitos no termo a API tira a
// pontuação ("beiramar") e não acha o nome com hífen.

/** Nome de exibição: o fantasia, ou a razão social quando o cliente não tem fantasia (1 em cada 5). */
export function nomeDoCliente(indice: number): string {
  const ramo = RAMOS[indice % RAMOS.length];
  const nome = NOMES[Math.floor(indice / RAMOS.length) % NOMES.length];
  const base = `${ramo} ${nome} ${String(indice + 1).padStart(3, '0')}`;
  return indice % 5 === 0 ? `${base} Ltda` : base;
}

/** 14 dígitos → 00.000.000/0000-00. */
export function mascararCnpj(cnpj: string): string {
  return cnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
}

// Revendedor fictício da Roma (`CLIENTE_REVENDA`, `ARTES_REVENDA` e `TAREFA_REVENDA` no `semear`, ADR 0017).
export const REVENDA = {
  nome: 'Revenda Ficticia',
  produto: 'Caixa de Pizza',
  artes: [
    { nome: 'Frente', clienteFinal: 'Pizzaria Fictícia Exemplo', pedido: '9900' },
    { nome: 'Verso', clienteFinal: 'Hamburgueria Exemplo', pedido: null },
    { nome: 'Padrão', clienteFinal: null, pedido: null },
  ],
  tarefa: { clienteFinal: 'Lanchonete Exemplo', pedido: '9901' },
} as const;

/** Título da tarefa aberta do revendedor: "Arte de <produto> para <cliente final> (<revendedor>)". */
export const TITULO_TAREFA_REVENDA = `Arte de ${REVENDA.produto} para ${REVENDA.tarefa.clienteFinal} (${REVENDA.nome})`;
