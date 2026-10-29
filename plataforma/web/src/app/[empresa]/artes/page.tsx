import type { Metadata } from 'next';

import { ListaClientes } from '../../../componentes/ListaClientes';

export const metadata: Metadata = {
  title: 'Artes · Plataforma RPA',
};

export default async function Artes({ params }: PageProps<'/[empresa]/artes'>) {
  const { empresa } = await params;
  return (
    <div className="pagina">
      <div className="card">
        <h2>Clientes</h2>
        <ListaClientes empresa={empresa} />
      </div>
    </div>
  );
}
