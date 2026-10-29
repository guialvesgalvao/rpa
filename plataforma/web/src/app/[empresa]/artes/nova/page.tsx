import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import Link from 'next/link';

import { FormNovaArte } from '../../../../componentes/FormNovaArte';
import { clienteDaEmpresa, opcoesNovaArte } from '../../../../servidor/artes';

export const metadata: Metadata = {
  title: 'Nova arte · Plataforma RPA',
};

export default async function NovaArte({
  params,
  searchParams,
}: PageProps<'/[empresa]/artes/nova'>) {
  const { empresa } = await params;
  const { cliente: clienteId } = await searchParams;
  if (typeof clienteId !== 'string') notFound();

  const [cliente, opcoes] = await Promise.all([
    clienteDaEmpresa(empresa, clienteId),
    opcoesNovaArte(empresa),
  ]);

  return (
    <div className="pagina">
      <p>
        <Link href={`/${empresa}/artes/clientes/${cliente.id}`}>← {cliente.nomeExibicao}</Link>
      </p>
      <div className="card">
        <h2>Nova arte · {cliente.nomeExibicao}</h2>
        <FormNovaArte empresa={empresa} clienteId={cliente.id} {...opcoes} />
      </div>
    </div>
  );
}
