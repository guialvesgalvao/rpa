import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { inicioDaEmpresa, permissoesNaEmpresa } from '../../modulos';
import { usuarioDaSessao } from '../../servidor/eu';

export const metadata: Metadata = {
  title: 'Plataforma RPA',
};

// Entrada da empresa (login, troca de senha e seletor de empresa caem aqui): abre a primeira aba permitida.
// Quem ainda não tem permissão em nenhum módulo desta empresa vê o aviso.
export default async function InicioDaEmpresa({ params }: PageProps<'/[empresa]'>) {
  const { empresa } = await params;
  const eu = await usuarioDaSessao();
  const inicio = inicioDaEmpresa(empresa, permissoesNaEmpresa(eu, empresa));
  if (inicio !== `/${empresa}`) redirect(inicio);

  return (
    <div className="pagina">
      <div className="card">
        <h2>Sem acesso</h2>
        <p role="status">Você ainda não tem acesso a nenhum módulo nesta empresa.</p>
        <p className="hint">Peça a quem administra os usuários para liberar as suas permissões.</p>
      </div>
    </div>
  );
}
