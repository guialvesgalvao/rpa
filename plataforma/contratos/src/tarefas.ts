import { z } from 'zod';

import { EsquemaOpcao } from './artes.ts';

// Tarefa de desenvolvimento de arte: registra quando o arte finalista começou e terminou a arte de um produto
// do catálogo para um cliente. Concluir exige os dados da arte, e a conclusão cadastra a arte.
export const STATUS_TAREFA = [
  'nao_iniciada',
  'em_desenvolvimento',
  'aguardando_cliente',
  'concluida',
  'cancelada',
] as const;
export const EsquemaStatusTarefa = z.enum(STATUS_TAREFA);
export type StatusTarefa = z.infer<typeof EsquemaStatusTarefa>;

export const ROTULOS_STATUS_TAREFA: Record<StatusTarefa, string> = {
  nao_iniciada: 'Não iniciado',
  em_desenvolvimento: 'Em desenvolvimento',
  aguardando_cliente: 'Aguardando validação do cliente',
  concluida: 'Concluída',
  cancelada: 'Cancelada',
};

// "Tarefas em andamento" do admin: tudo o que não terminou (nem concluída, nem cancelada).
export const STATUS_EM_ANDAMENTO: readonly StatusTarefa[] = [
  'nao_iniciada',
  'em_desenvolvimento',
  'aguardando_cliente',
];

// `minhas`: as do usuário; `andamento`: as não terminadas de todos; `todas`: todas. O arte finalista só vê
// as próprias, qualquer que seja o escopo.
export const ESCOPOS_TAREFAS = ['minhas', 'andamento', 'todas'] as const;
export type EscopoTarefas = (typeof ESCOPOS_TAREFAS)[number];

export const EsquemaConsultaTarefas = z.object({
  escopo: z.enum(ESCOPOS_TAREFAS).default('minhas'),
  status: EsquemaStatusTarefa.optional(),
});

export const ORIGENS_TAREFA = ['manual', 'bling_pedido'] as const;
export type OrigemTarefa = (typeof ORIGENS_TAREFA)[number];

export const EsquemaTarefa = z.object({
  id: z.uuid(),
  cliente: EsquemaOpcao,
  produto: EsquemaOpcao,
  // `null` se o usuário foi removido ou se a tarefa automática nasceu sem responsável.
  responsavel: EsquemaOpcao.nullable(),
  status: EsquemaStatusTarefa,
  // Tarefa criada na tela (`manual`) ou a partir de um pedido de venda do Bling (com o número).
  origem: z.enum(ORIGENS_TAREFA).default('manual'),
  pedidoNumero: z.string().nullable().default(null),
  // Arte cadastrada na conclusão; `null` até concluir.
  arteId: z.uuid().nullable(),
  criadoEm: z.iso.datetime(),
  atualizadoEm: z.iso.datetime(),
});

export const COMENTARIO_TAREFA_MAX = 2000;
// Anexos por comentário (PDF ou imagem, com os limites das artes).
export const ANEXOS_POR_COMENTARIO = 5;

export const EsquemaAnexoComentario = z.object({
  id: z.uuid(),
  nome: z.string(),
  tipoMime: z.string(),
  tamanho: z.number().int().positive(),
});

export const EsquemaComentarioTarefa = z.object({
  id: z.uuid(),
  autor: EsquemaOpcao.nullable(),
  // Vazio quando o comentário é só anexo.
  texto: z.string(),
  anexos: z.array(EsquemaAnexoComentario).default([]),
  criadoEm: z.iso.datetime(),
});

export const EsquemaTarefaDetalhe = EsquemaTarefa.extend({
  comentarios: z.array(EsquemaComentarioTarefa),
});

// Uma mudança de status; a criação tem `statusAnterior` nulo.
export const EsquemaEventoTarefa = z.object({
  id: z.uuid(),
  statusAnterior: EsquemaStatusTarefa.nullable(),
  statusNovo: EsquemaStatusTarefa,
  autor: EsquemaOpcao.nullable(),
  criadoEm: z.iso.datetime(),
});

export const EsquemaNovoComentario = z.object({
  texto: z.string().trim().min(1).max(COMENTARIO_TAREFA_MAX),
});

export const EsquemaMudancaStatus = z.object({ status: EsquemaStatusTarefa });

// Responsável pelas tarefas automáticas da empresa (só admin). `responsavelId`: o configurado (`null` = nenhum;
// vale a única arte finalista ativa, se houver só uma). `elegiveis`: arte finalistas ativos da empresa.
export const EsquemaResponsavelAutomatico = z.object({
  responsavelId: z.uuid().nullable(),
  elegiveis: z.array(EsquemaOpcao),
});
export const EsquemaDefinirResponsavelAutomatico = z.object({ responsavelId: z.uuid().nullable() });

export type ResponsavelAutomatico = z.infer<typeof EsquemaResponsavelAutomatico>;

export type ConsultaTarefas = z.infer<typeof EsquemaConsultaTarefas>;
export type Tarefa = z.infer<typeof EsquemaTarefa>;
export type ComentarioTarefa = z.infer<typeof EsquemaComentarioTarefa>;
export type AnexoComentario = z.infer<typeof EsquemaAnexoComentario>;
export type TarefaDetalhe = z.infer<typeof EsquemaTarefaDetalhe>;
export type EventoTarefa = z.infer<typeof EsquemaEventoTarefa>;
export type NovoComentario = z.infer<typeof EsquemaNovoComentario>;
export type MudancaStatus = z.infer<typeof EsquemaMudancaStatus>;

// Ex.: "Arte de Caixa de pizza 35x35 para Pizzaria Ficticia".
export const tituloTarefa = (tarefa: Pick<Tarefa, 'cliente' | 'produto'>): string =>
  `Arte de ${tarefa.produto.nome} para ${tarefa.cliente.nome}`;

// A conclusão sem arte vinculada precisa dos dados da arte (rota `concluir`); com arte, basta mudar o status.
export const precisaDaArteParaConcluir = (tarefa: Pick<Tarefa, 'arteId'>): boolean =>
  tarefa.arteId === null;

// Contagem dos atalhos da home de Artes: só os status não terminados. O arte finalista conta as próprias; o
// admin, todas da empresa.
export const EsquemaContagemTarefas = z.object({
  nao_iniciada: z.number().int().min(0),
  em_desenvolvimento: z.number().int().min(0),
  aguardando_cliente: z.number().int().min(0),
});
export type ContagemTarefas = z.infer<typeof EsquemaContagemTarefas>;
export type StatusContado = keyof ContagemTarefas;

/** Atalho da home de Artes: abre a lista já filtrada pelo status (`null` = todas, sem contador). */
export type AtalhoTarefas = { valor: string; rotulo: string; status: StatusContado | null };

export const ATALHOS_TAREFAS: readonly AtalhoTarefas[] = [
  { valor: 'pendentes', rotulo: 'Pendentes', status: 'nao_iniciada' },
  { valor: 'em_andamento', rotulo: 'Em andamento', status: 'em_desenvolvimento' },
  { valor: 'aguardando', rotulo: 'Aguardando validação', status: 'aguardando_cliente' },
  { valor: 'todas', rotulo: 'Todos', status: null },
];

// Ex.: "Pendentes (3)"; "Todos" não tem contador, nem os outros enquanto a contagem não chega.
export const rotuloAtalho = (atalho: AtalhoTarefas, contagem?: ContagemTarefas | null): string =>
  atalho.status && contagem ? `${atalho.rotulo} (${contagem[atalho.status]})` : atalho.rotulo;

/** Opção do filtro da lista de tarefas: o rótulo e a consulta que ela faz. */
export type FiltroTarefas = {
  valor: string;
  rotulo: string;
  consulta: { escopo: EscopoTarefas; status?: StatusTarefa };
};

// Filtros da lista. "Tarefas em andamento" (admin) abre nas não terminadas de todos e deixa ver todas ou um
// status; "Minhas tarefas" abre em todas as do usuário e deixa filtrar por status.
export function filtrosDeTarefas(escopo: EscopoTarefas): FiltroTarefas[] {
  const base: EscopoTarefas = escopo === 'minhas' ? 'minhas' : 'todas';
  const porStatus = STATUS_TAREFA.map((status): FiltroTarefas => ({
    valor: status,
    rotulo: ROTULOS_STATUS_TAREFA[status],
    consulta: { escopo: base, status },
  }));
  if (escopo === 'andamento') {
    return [
      { valor: '', rotulo: 'Em andamento', consulta: { escopo: 'andamento' } },
      { valor: 'todas', rotulo: 'Todas', consulta: { escopo: 'todas' } },
      ...porStatus,
    ];
  }
  return [{ valor: '', rotulo: 'Todas', consulta: { escopo: base } }, ...porStatus];
}

// Ex.: "Criada como Não iniciado" ou "Não iniciado → Em desenvolvimento".
export function descreverEvento(
  evento: Pick<EventoTarefa, 'statusAnterior' | 'statusNovo'>,
): string {
  const novo = ROTULOS_STATUS_TAREFA[evento.statusNovo];
  if (!evento.statusAnterior) return `Criada como ${novo}`;
  return `${ROTULOS_STATUS_TAREFA[evento.statusAnterior]} → ${novo}`;
}

// Status escolhido na tela: concluir sem arte abre o formulário da arte em vez de chamar a API.
export function acaoDoStatus(
  status: StatusTarefa,
  tarefa: Pick<Tarefa, 'status' | 'arteId'>,
): 'nada' | 'pedir_arte' | 'mudar' {
  if (status === tarefa.status) return 'nada';
  if (status === 'concluida' && tarefa.arteId === null) return 'pedir_arte';
  return 'mudar';
}
