import { z } from 'zod';

import { EsquemaOpcao } from './artes.ts';
import { EMPRESAS_SINCRONIZACAO_BLING } from './bling.ts';
import { EsquemaArea } from './permissoes.ts';
import { COMENTARIO_TAREFA_MAX, EsquemaComentarioTarefa } from './tarefas.ts';

// Pedidos de compra de insumos (ADR 0012), tratados como tarefas: alguém pede, quem acompanha assume e leva até
// concluir. Só nas empresas com sincronização do Bling, onde os insumos chegam como produtos. A lista de status
// se repete no CHECK de `compras_pedidos.status`: mudar junto.
export const STATUS_COMPRA = ['aberta', 'em_andamento', 'concluida', 'cancelada'] as const;
export const EsquemaStatusCompra = z.enum(STATUS_COMPRA);
export type StatusCompra = z.infer<typeof EsquemaStatusCompra>;

export const ROTULOS_STATUS_COMPRA: Record<StatusCompra, string> = {
  aberta: 'Aberta',
  em_andamento: 'Em andamento',
  concluida: 'Concluída',
  cancelada: 'Cancelada',
};

// Enquanto o pedido está num destes status, o criador e quem acompanha podem editar insumo, quantidade e
// observação.
export const STATUS_COMPRA_EDITAVEIS: readonly StatusCompra[] = ['aberta', 'em_andamento'];

export const pedidoEditavel = (pedido: { status: StatusCompra }): boolean =>
  STATUS_COMPRA_EDITAVEIS.includes(pedido.status);

// Insumo é o produto ativo da empresa com código começando por este prefixo.
export const PREFIXO_INSUMO = 'TPP';

export const ehCodigoDeInsumo = (codigo: string | null | undefined): boolean =>
  typeof codigo === 'string' && codigo.startsWith(PREFIXO_INSUMO);

/** O módulo Compras só existe nas empresas com sincronização do Bling. */
export const empresaTemCompras = (slug: string | undefined): boolean =>
  slug !== undefined && (EMPRESAS_SINCRONIZACAO_BLING as readonly string[]).includes(slug);

// `meus`: os que criei ou de que sou responsável; `abertos`: os não terminados; `todos`: todos. Quem não acompanha
// todos os pedidos só alcança os que criou, qualquer que seja o escopo.
export const ESCOPOS_COMPRAS = ['meus', 'abertos', 'todos'] as const;
export type EscopoCompras = (typeof ESCOPOS_COMPRAS)[number];

export const EsquemaConsultaCompras = z.object({
  escopo: z.enum(ESCOPOS_COMPRAS).default('meus'),
  status: EsquemaStatusCompra.optional(),
});

export const EsquemaInsumo = z.object({ id: z.uuid(), codigo: z.string(), nome: z.string() });

// Mesma precisão da coluna `numeric(12,3)`: até 9 dígitos inteiros e 3 decimais.
export const QUANTIDADE_COMPRA_MAX = 999_999_999;
export const OBSERVACAO_COMPRA_MAX = 500;

const temAteTresDecimais = (valor: number) =>
  Math.abs(valor * 1000 - Math.round(valor * 1000)) < 1e-6;

export const EsquemaQuantidadeCompra = z
  .number()
  .positive()
  .max(QUANTIDADE_COMPRA_MAX)
  .refine(temAteTresDecimais, 'Use no máximo 3 casas decimais.');

// Observação vazia vira `null`.
const EsquemaObservacao = z
  .string()
  .trim()
  .max(OBSERVACAO_COMPRA_MAX)
  .transform((texto) => texto || null)
  .nullable();

export const EsquemaPedidoCompra = z.object({
  id: z.uuid(),
  insumo: EsquemaInsumo,
  quantidade: z.number().positive(),
  observacao: z.string().nullable(),
  status: EsquemaStatusCompra,
  // `null` se o usuário foi removido.
  criador: EsquemaOpcao.nullable(),
  // Área do criador no momento do pedido (nula se ele não tinha área).
  areaCriador: EsquemaArea.nullable(),
  responsavel: EsquemaOpcao.nullable(),
  criadoEm: z.iso.datetime(),
  atualizadoEm: z.iso.datetime(),
});

// Comentários com os mesmos limites e o mesmo formato dos das tarefas de arte (texto até 2000, até 5 anexos PDF ou
// imagem).
export const COMENTARIO_COMPRA_MAX = COMENTARIO_TAREFA_MAX;
export const EsquemaComentarioCompra = EsquemaComentarioTarefa;
export const EsquemaNovoComentarioCompra = z.object({
  texto: z.string().trim().min(1).max(COMENTARIO_COMPRA_MAX),
});

// Resposta de `GET /pedidos/:id`: o pedido com os comentários, do mais antigo para o mais novo.
export const EsquemaPedidoCompraDetalhe = EsquemaPedidoCompra.extend({
  comentarios: z.array(EsquemaComentarioCompra),
});

export const EsquemaNovoPedidoCompra = z.object({
  insumoId: z.uuid(),
  quantidade: EsquemaQuantidadeCompra,
  observacao: EsquemaObservacao.optional(),
});

// Só os campos informados mudam; ao menos um.
export const EsquemaEdicaoPedidoCompra = z
  .object({
    insumoId: z.uuid().optional(),
    quantidade: EsquemaQuantidadeCompra.optional(),
    observacao: EsquemaObservacao.optional(),
  })
  .refine((edicao) => Object.values(edicao).some((valor) => valor !== undefined), {
    message: 'Informe ao menos um campo.',
  });

export const EsquemaMudancaStatusCompra = z.object({ status: EsquemaStatusCompra });

// Eventos do histórico. Os nomes (insumo e pessoas) são os do momento da mudança.
export const TIPOS_EVENTO_COMPRA = ['criacao', 'status', 'responsavel', 'edicao'] as const;
export type TipoEventoCompra = (typeof TIPOS_EVENTO_COMPRA)[number];

const mudanca = <T extends z.ZodType>(valor: T) => z.object({ de: valor, para: valor });

export const EsquemaDadosEventoCompra = z.discriminatedUnion('tipo', [
  z.object({ tipo: z.literal('criacao') }),
  z.object({ tipo: z.literal('status'), de: EsquemaStatusCompra, para: EsquemaStatusCompra }),
  z.object({
    tipo: z.literal('responsavel'),
    de: EsquemaOpcao.nullable(),
    para: EsquemaOpcao.nullable(),
  }),
  z.object({
    tipo: z.literal('edicao'),
    insumo: mudanca(z.string()).optional(),
    quantidade: mudanca(z.number()).optional(),
    observacao: mudanca(z.string().nullable()).optional(),
  }),
]);
export type DadosEventoCompra = z.infer<typeof EsquemaDadosEventoCompra>;

export const EsquemaEventoCompra = z.object({
  id: z.uuid(),
  dados: EsquemaDadosEventoCompra,
  autor: EsquemaOpcao.nullable(),
  criadoEm: z.iso.datetime(),
});

export type ConsultaCompras = z.infer<typeof EsquemaConsultaCompras>;
export type Insumo = z.infer<typeof EsquemaInsumo>;
export type PedidoCompra = z.infer<typeof EsquemaPedidoCompra>;
export type NovoPedidoCompra = z.infer<typeof EsquemaNovoPedidoCompra>;
export type EdicaoPedidoCompra = z.infer<typeof EsquemaEdicaoPedidoCompra>;
export type MudancaStatusCompra = z.infer<typeof EsquemaMudancaStatusCompra>;
export type EventoCompra = z.infer<typeof EsquemaEventoCompra>;
export type ComentarioCompra = z.infer<typeof EsquemaComentarioCompra>;
export type NovoComentarioCompra = z.infer<typeof EsquemaNovoComentarioCompra>;
export type PedidoCompraDetalhe = z.infer<typeof EsquemaPedidoCompraDetalhe>;

// Ex.: "TPP001 — Tinta preta 1 L".
export const rotuloInsumo = (insumo: Pick<Insumo, 'codigo' | 'nome'>): string =>
  `${insumo.codigo} — ${insumo.nome}`;

// Quantidade no formato brasileiro, sem zeros à direita: 1.234,5.
export const formatarQuantidade = (quantidade: number): string =>
  quantidade.toLocaleString('pt-BR', { maximumFractionDigits: 3 });

const ouNada = (texto: string | null) => texto || '(vazia)';

// Ex.: "Pedido criado", "Aberta → Em andamento", "Responsável: Ana Ficticia", "Quantidade: 10 → 12".
export function descreverEventoCompra(dados: DadosEventoCompra): string {
  switch (dados.tipo) {
    case 'criacao':
      return 'Pedido criado';
    case 'status':
      return `${ROTULOS_STATUS_COMPRA[dados.de]} → ${ROTULOS_STATUS_COMPRA[dados.para]}`;
    case 'responsavel':
      if (!dados.para) return `Responsável removido (era ${dados.de?.nome ?? 'ninguém'})`;
      return dados.de
        ? `Responsável: ${dados.de.nome} → ${dados.para.nome}`
        : `Responsável: ${dados.para.nome}`;
    case 'edicao': {
      const partes: string[] = [];
      if (dados.insumo) partes.push(`Insumo: ${dados.insumo.de} → ${dados.insumo.para}`);
      if (dados.quantidade) {
        partes.push(
          `Quantidade: ${formatarQuantidade(dados.quantidade.de)} → ${formatarQuantidade(dados.quantidade.para)}`,
        );
      }
      if (dados.observacao) {
        partes.push(
          `Observação: ${ouNada(dados.observacao.de)} → ${ouNada(dados.observacao.para)}`,
        );
      }
      return partes.length ? partes.join('; ') : 'Pedido editado';
    }
  }
}
