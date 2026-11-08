import {
  ESCOPOS_TAREFAS,
  filtrosDeTarefas,
  ROTULOS_STATUS_TAREFA,
  tituloTarefa,
  type EscopoTarefas,
} from '@plataforma/contratos';
import type { Metadata } from 'next';
import Link from 'next/link';

import { formatarDataHora } from '../../../../datas';
import { usuarioDaSessao } from '../../../../servidor/eu';
import { tarefasDaEmpresa } from '../../../../servidor/artes';

export const metadata: Metadata = {
  title: 'Tarefas de arte · Plataforma RPA',
};

const ehEscopo = (valor: unknown): valor is EscopoTarefas =>
  typeof valor === 'string' && (ESCOPOS_TAREFAS as readonly string[]).includes(valor);

// Lista aberta pelos atalhos da home de Artes (`escopo=todas&filtro=<status>`), com o filtro de status num GET
// simples. O arte finalista só vê as próprias (a API decide), qualquer que seja o escopo.
export default async function Tarefas({
  params,
  searchParams,
}: PageProps<'/[empresa]/artes/tarefas'>) {
  const { empresa } = await params;
  const { escopo: escopoPedido, filtro: filtroPedido } = await searchParams;
  const eu = await usuarioDaSessao();
  const escopo: EscopoTarefas = ehEscopo(escopoPedido) ? escopoPedido : 'todas';
  const filtros = filtrosDeTarefas(escopo);
  const filtro = filtros.find((f) => f.valor === filtroPedido) ?? filtros[0]!;
  const tarefas = await tarefasDaEmpresa(empresa, filtro.consulta);
  const comResponsavel = eu.perfil === 'admin';

  return (
    <div className="pagina">
      <p>
        <Link href={`/${empresa}/artes`}>← Artes</Link>
      </p>
      <div className="card">
        <h2>Tarefas de arte</h2>
        <form className="filtro" method="get">
          <input type="hidden" name="escopo" value={escopo} />
          <label htmlFor="filtro">Status</label>
          <select id="filtro" name="filtro" defaultValue={filtro.valor}>
            {filtros.map((f) => (
              <option key={f.valor} value={f.valor}>
                {f.rotulo}
              </option>
            ))}
          </select>
          <button type="submit">Filtrar</button>
        </form>
        {tarefas.length === 0 ? (
          <div className="hint">Nenhuma tarefa encontrada.</div>
        ) : (
          <ul className="lista">
            {tarefas.map((tarefa) => (
              <li key={tarefa.id}>
                <Link href={`/${empresa}/artes/tarefas/${tarefa.id}`}>
                  <strong>{tituloTarefa(tarefa)}</strong>
                  <span className="hint">
                    {comResponsavel && `${tarefa.responsavel?.nome ?? 'Sem responsável'} · `}
                    Atualizada em {formatarDataHora(tarefa.atualizadoEm)}
                  </span>
                </Link>
                <span className="selo-tarefa" data-status={tarefa.status}>
                  {ROTULOS_STATUS_TAREFA[tarefa.status]}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
