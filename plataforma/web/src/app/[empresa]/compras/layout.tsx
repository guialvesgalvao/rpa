import { empresaTemCompras } from '@plataforma/contratos';
import { notFound } from 'next/navigation';

import { exigirPermissaoNaPagina } from '../../../servidor/eu';

// Todas as páginas de Compras exigem o módulo e uma empresa com sincronização do Bling; senão, 404 (a API também
// recusa).
export default async function LayoutCompras({
  children,
  params,
}: LayoutProps<'/[empresa]/compras'>) {
  const { empresa } = await params;
  if (!empresaTemCompras(empresa)) notFound();
  await exigirPermissaoNaPagina(empresa, 'compras');
  return children;
}
