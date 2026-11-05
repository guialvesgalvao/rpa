import { descreverEvento, tituloTarefa } from '@plataforma/contratos';
import type { Metadata } from 'next';
import Link from 'next/link';

import { formatarDataHora } from '../../../../../../datas';
import { historicoDaTarefa, tarefaDaEmpresa } from '../../../../../../servidor/artes';

export const metadata: Metadata = {
  title: 'Histórico da tarefa · Plataforma RPA',
};

// Cada mudança de status com data/hora e autor, da criação até a mais recente.
export default async function HistoricoTarefa({
  params,
}: PageProps<'/[empresa]/artes/tarefas/[id]/historico'>) {
  const { empresa, id } = await params;
  const [tarefa, eventos] = await Promise.all([
    tarefaDaEmpresa(empresa, id),
    historicoDaTarefa(empresa, id),
  ]);

  return (
    <div className="pagina">
      <p>
        <Link href={`/${empresa}/artes/tarefas/${tarefa.id}`}>← {tituloTarefa(tarefa)}</Link>
      </p>
      <div className="card">
        <h2>Histórico</h2>
        <table className="tabela-historico">
          <thead>
            <tr>
              <th>Data/hora</th>
              <th>Mudança</th>
              <th>Por</th>
            </tr>
          </thead>
          <tbody>
            {eventos.map((evento) => (
              <tr key={evento.id}>
                <td>{formatarDataHora(evento.criadoEm)}</td>
                <td>{descreverEvento(evento)}</td>
                <td>{evento.autor?.nome ?? 'Usuário removido'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
