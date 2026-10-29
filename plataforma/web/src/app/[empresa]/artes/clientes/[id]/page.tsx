import { rotuloArtes } from '@plataforma/contratos';
import type { Metadata } from 'next';
import Link from 'next/link';

import { clienteDaEmpresa, produtosDoCliente } from '../../../../../servidor/artes';

export const metadata: Metadata = {
  title: 'Cliente · Plataforma RPA',
};

export default async function PaginaCliente({
  params,
  searchParams,
}: PageProps<'/[empresa]/artes/clientes/[id]'>) {
  const { empresa, id } = await params;
  const { cadastrada } = await searchParams;
  const [cliente, produtos] = await Promise.all([
    clienteDaEmpresa(empresa, id),
    produtosDoCliente(empresa, id),
  ]);

  return (
    <div className="pagina">
      <p>
        <Link href={`/${empresa}/artes`}>← Clientes</Link>
      </p>
      {cadastrada !== undefined && (
        <p className="sucesso" role="status">
          Arte cadastrada
        </p>
      )}
      <div className="card">
        <h2>{cliente.nomeExibicao}</h2>
        {cliente.nomeFantasia && <div className="hint">{cliente.razaoSocial}</div>}
        <div className="actions">
          <Link className="botao primary" href={`/${empresa}/artes/nova?cliente=${cliente.id}`}>
            Cadastrar nova arte
          </Link>
        </div>
      </div>
      <div className="card">
        <h2>Produtos com arte</h2>
        {produtos.length === 0 ? (
          <div className="hint">Nenhuma arte cadastrada para este cliente.</div>
        ) : (
          <ul className="lista">
            {produtos.map((produto) => (
              <li key={produto.id}>
                <span>{produto.nome}</span>
                <span className="status pendente">{rotuloArtes(produto.quantidadeArtes)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
