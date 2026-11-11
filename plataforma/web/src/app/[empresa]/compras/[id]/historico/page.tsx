import { descreverEventoCompra, rotuloInsumo } from '@plataforma/contratos';
import type { Metadata } from 'next';
import Link from 'next/link';

import { formatarDataHora } from '../../../../../datas';
import { historicoDoPedido, pedidoDaEmpresa } from '../../../../../servidor/compras';

export const metadata: Metadata = {
  title: 'Histórico do pedido · Plataforma RPA',
};

// Cada mudança do pedido (criação, responsável, status e edição) com data/hora e autor.
export default async function HistoricoPedido({
  params,
}: PageProps<'/[empresa]/compras/[id]/historico'>) {
  const { empresa, id } = await params;
  const [pedido, eventos] = await Promise.all([
    pedidoDaEmpresa(empresa, id),
    historicoDoPedido(empresa, id),
  ]);

  return (
    <div className="pagina">
      <p>
        <Link href={`/${empresa}/compras/${pedido.id}`}>← {rotuloInsumo(pedido.insumo)}</Link>
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
                <td>{descreverEventoCompra(evento.dados)}</td>
                <td>{evento.autor?.nome ?? 'Usuário removido'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
