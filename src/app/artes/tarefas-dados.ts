import type { ConsultaTarefasApp } from '../api.js';
import {
  type EscopoTarefas,
  type EventoTarefa,
  ROTULOS_STATUS_TAREFA,
  STATUS_TAREFA,
  type StatusTarefa,
} from '../plataforma/contratos.js';

/** Opção do filtro da lista de tarefas: o rótulo e a consulta que ela faz. */
export type FiltroTarefas = { valor: string; rotulo: string; consulta: ConsultaTarefasApp };

/**
 * Filtros da lista. "Tarefas em andamento" (admin) abre nas não terminadas de todos e deixa ver todas
 * ou um status; "Minhas tarefas" abre em todas as do usuário e deixa filtrar por status.
 */
export function filtrosDeTarefas(escopo: EscopoTarefas): FiltroTarefas[] {
  const base = escopo === 'minhas' ? 'minhas' : 'todas';
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

const doisDigitos = (n: number) => String(n).padStart(2, '0');

/** Ex.: "05/11/2026 14:32" (hora local). */
export function formatarDataHora(iso: string): string {
  const d = new Date(iso);
  return `${doisDigitos(d.getDate())}/${doisDigitos(d.getMonth() + 1)}/${d.getFullYear()} ${doisDigitos(d.getHours())}:${doisDigitos(d.getMinutes())}`;
}

/** Ex.: "Criada como Não iniciado" ou "Não iniciado → Em desenvolvimento". */
export function descreverEvento(
  evento: Pick<EventoTarefa, 'statusAnterior' | 'statusNovo'>,
): string {
  const novo = ROTULOS_STATUS_TAREFA[evento.statusNovo];
  if (!evento.statusAnterior) return `Criada como ${novo}`;
  return `${ROTULOS_STATUS_TAREFA[evento.statusAnterior]} → ${novo}`;
}

/** Status escolhido no seletor: concluir sem arte abre o formulário da arte em vez de chamar a API. */
export function acaoDoStatus(
  status: StatusTarefa,
  tarefa: { status: StatusTarefa; arteId: string | null },
): 'nada' | 'pedir_arte' | 'mudar' {
  if (status === tarefa.status) return 'nada';
  if (status === 'concluida' && tarefa.arteId === null) return 'pedir_arte';
  return 'mudar';
}
