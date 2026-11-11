import type { Metadata } from 'next';
import Link from 'next/link';

import { FormPedido } from '../../../../componentes/FormPedido';
import { insumosDaEmpresa } from '../../../../servidor/compras';
import { exigirPermissaoNaPagina } from '../../../../servidor/eu';

export const metadata: Metadata = {
  title: 'Novo pedido de compra · Plataforma RPA',
};

export default async function NovoPedido({ params }: PageProps<'/[empresa]/compras/novo'>) {
  const { empresa } = await params;
  await exigirPermissaoNaPagina(empresa, 'compras.pedir');
  const insumos = await insumosDaEmpresa(empresa);

  return (
    <div className="pagina">
      <p>
        <Link href={`/${empresa}/compras`}>← Compras</Link>
      </p>
      <div className="card">
        <h2>Novo pedido de compra</h2>
        {insumos.length === 0 ? (
          <div className="hint">
            Nenhum insumo (produto com código TPP) sincronizado do Bling nesta empresa.
          </div>
        ) : (
          <FormPedido empresa={empresa} insumos={insumos} />
        )}
      </div>
    </div>
  );
}
