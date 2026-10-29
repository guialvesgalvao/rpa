import { notFound } from 'next/navigation';

import { MenuLateral } from '../../componentes/MenuLateral';
import { ordenarEmpresas } from '../../empresas';
import { usuarioDaSessao } from '../../servidor/eu';

// As páginas de uma empresa: tema dela (`data-empresa`) e menu lateral. Empresa alheia ou inexistente → 404.
export default async function LayoutEmpresa({ children, params }: LayoutProps<'/[empresa]'>) {
  const { empresa: slug } = await params;
  const eu = await usuarioDaSessao();
  const empresas = ordenarEmpresas(eu.empresas);
  const atual = empresas.find((empresa) => empresa.slug === slug);
  if (!atual) notFound();

  return (
    <div className="empresa" data-empresa={atual.slug}>
      <div className="app">
        <MenuLateral atual={atual} empresas={empresas} usuario={eu.nome} />
        <main>{children}</main>
      </div>
      <footer>Plataforma RPA</footer>
    </div>
  );
}
