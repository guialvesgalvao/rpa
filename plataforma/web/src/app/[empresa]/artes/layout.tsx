import { exigirPermissaoNaPagina } from '../../../servidor/eu';

// Todas as páginas de Artes exigem o módulo; sem ele, 404 (a API também recusa as leituras).
export default async function LayoutArtes({ children, params }: LayoutProps<'/[empresa]/artes'>) {
  const { empresa } = await params;
  await exigirPermissaoNaPagina(empresa, 'artes');
  return children;
}
