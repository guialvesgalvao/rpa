import { ROTULOS_ESCOPO_TAREFAS, submenusTarefas } from '@plataforma/contratos';
import type { Metadata } from 'next';
import Link from 'next/link';

import { ListaClientes } from '../../../componentes/ListaClientes';
import { usuarioDaSessao } from '../../../servidor/eu';

export const metadata: Metadata = {
  title: 'Artes · Plataforma RPA',
};

export default async function Artes({ params }: PageProps<'/[empresa]/artes'>) {
  const { empresa } = await params;
  const eu = await usuarioDaSessao();
  return (
    <div className="pagina">
      <nav className="submenu" aria-label="Tarefas de arte">
        {submenusTarefas(eu.perfil).map((escopo) => (
          <Link key={escopo} className="botao" href={`/${empresa}/artes/tarefas?escopo=${escopo}`}>
            {ROTULOS_ESCOPO_TAREFAS[escopo]}
          </Link>
        ))}
      </nav>
      <div className="card">
        <h2>Clientes</h2>
        <ListaClientes empresa={empresa} />
      </div>
    </div>
  );
}
