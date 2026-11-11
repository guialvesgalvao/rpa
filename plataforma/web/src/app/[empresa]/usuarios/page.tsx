import { rotuloArea, temPermissao } from '@plataforma/contratos';
import type { Metadata } from 'next';
import Link from 'next/link';

import { FormUsuario } from '../../../componentes/FormUsuario';
import { exigirPermissaoNaPagina } from '../../../servidor/eu';
import { usuariosDaEmpresa } from '../../../servidor/usuarios';
import { empresasCom } from '../../../usuarios';

export const metadata: Metadata = {
  title: 'Usuários · Plataforma RPA',
};

// Painel de usuários da empresa (ADR 0011): quem tem o módulo vê a lista; criar, editar e excluir exigem
// "Editar e excluir usuários"; marcar permissões exige "Editar permissão de usuários". A API confere de novo.
export default async function Usuarios({ params, searchParams }: PageProps<'/[empresa]/usuarios'>) {
  const { empresa } = await params;
  const { excluido } = await searchParams;
  const { eu, permissoes } = await exigirPermissaoNaPagina(empresa, 'usuarios');
  const usuarios = await usuariosDaEmpresa(empresa);
  const nomes = new Map(eu.empresas.map((e) => [e.slug, e.nome]));
  const podeEditar = temPermissao(permissoes, 'usuarios.editar');
  const podeAbrir = podeEditar || temPermissao(permissoes, 'usuarios.permissoes');

  return (
    <div className="pagina">
      {excluido !== undefined && (
        <p className="sucesso" role="status">
          Usuário excluído
        </p>
      )}
      <div className="card">
        <h2>Usuários</h2>
        {usuarios.length === 0 ? (
          <div className="hint">Nenhum usuário encontrado.</div>
        ) : (
          <div className="tabela-rolagem">
            <table className="tabela">
              <thead>
                <tr>
                  <th>Nome</th>
                  <th>E-mail</th>
                  <th>Área</th>
                  <th>Empresas</th>
                  {podeAbrir && <th>Ações</th>}
                </tr>
              </thead>
              <tbody>
                {usuarios.map((usuario) => (
                  <tr key={usuario.id}>
                    <td>
                      {usuario.nome}
                      {!usuario.ativo && <span className="hint"> (inativo)</span>}
                    </td>
                    <td>{usuario.email}</td>
                    <td>{rotuloArea(usuario.area)}</td>
                    <td>{usuario.empresas.map((e) => nomes.get(e.slug) ?? e.slug).join(', ')}</td>
                    {podeAbrir && (
                      <td>
                        <Link
                          href={`/${empresa}/usuarios/${usuario.id}`}
                          aria-label={`Editar ${usuario.nome}`}
                        >
                          Editar
                        </Link>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {podeEditar && (
        <div className="card">
          <h2>Novo usuário</h2>
          <FormUsuario
            empresa={empresa}
            empresas={empresasCom(eu, 'usuarios.editar')}
            empresasComPermissoes={empresasCom(eu, 'usuarios.permissoes').map((e) => e.slug)}
          />
        </div>
      )}
    </div>
  );
}
