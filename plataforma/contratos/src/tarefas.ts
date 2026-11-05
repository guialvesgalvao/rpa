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

export const EsquemaTarefa = z.object({
  id: z.uuid(),
  cliente: EsquemaOpcao,
  produto: EsquemaOpcao,
  // `null` se o usuário foi removido.
  responsavel: EsquemaOpcao.nullable(),
  status: EsquemaStatusTarefa,
  // Arte cadastrada na conclusão; `null` até concluir.
  arteId: z.uuid().nullable(),
  criadoEm: z.iso.datetime(),
  atualizadoEm: z.iso.datetime(),
});

export const COMENTARIO_TAREFA_MAX = 2000;

export const EsquemaComentarioTarefa = z.object({
  id: z.uuid(),
  autor: EsquemaOpcao.nullable(),
  texto: z.string(),
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

export type ConsultaTarefas = z.infer<typeof EsquemaConsultaTarefas>;
export type Tarefa = z.infer<typeof EsquemaTarefa>;
export type ComentarioTarefa = z.infer<typeof EsquemaComentarioTarefa>;
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

// Submenus da home de Artes por perfil.
export const submenusTarefas = (perfil: 'admin' | 'arte_finalista'): EscopoTarefas[] =>
  perfil === 'admin' ? ['andamento'] : ['minhas'];

export const ROTULOS_ESCOPO_TAREFAS: Record<EscopoTarefas, string> = {
  minhas: 'Minhas tarefas',
  andamento: 'Tarefas em andamento',
  todas: 'Todas as tarefas',
};
