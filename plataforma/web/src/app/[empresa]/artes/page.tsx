import { ATALHOS_TAREFAS, rotuloAtalho } from '@plataforma/contratos';
import type { Metadata } from 'next';
import Link from 'next/link';

import { ListaClientes } from '../../../componentes/ListaClientes';
import { contagemTarefas } from '../../../servidor/artes';

export const metadata: Metadata = {
  title: 'Artes · Plataforma RPA',
};

// Atalhos das tarefas com contador (o arte finalista conta as próprias; o admin, todas da empresa).
export default async function Artes({ params }: PageProps<'/[empresa]/artes'>) {
  const { empresa } = await params;
  const contagem = await contagemTarefas(empresa);
  return (
    <div className="pagina">
      <nav className="submenu" aria-label="Tarefas de arte">
        {ATALHOS_TAREFAS.map((atalho) => {
          const filtro = atalho.status ? `&filtro=${atalho.status}` : '';
          return (
            <Link
              key={atalho.valor}
              className="botao"
              href={`/${empresa}/artes/tarefas?escopo=todas${filtro}`}
            >
              {rotuloAtalho(atalho, contagem)}
            </Link>
          );
        })}
      </nav>
      <div className="card">
        <h2>Clientes</h2>
        <ListaClientes empresa={empresa} />
      </div>
    </div>
  );
}
