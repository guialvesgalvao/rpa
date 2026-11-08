import { ROTULOS_PERFIL } from '@plataforma/contratos';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { FormNovoUsuario } from '../../../componentes/FormNovoUsuario';
import { usuarioDaSessao } from '../../../servidor/eu';
import { usuariosDoAdmin } from '../../../servidor/usuarios';
import { opcoesDeEmpresa } from '../../../usuarios';

export const metadata: Metadata = {
  title: 'Usuários · Plataforma RPA',
};

// Só admin: lista os usuários das empresas dele e cria novos (editar, desativar e trocar a senha de outro
// usuário continuam na CLI). A API confere perfil e empresas de novo.
export default async function Usuarios() {
  const eu = await usuarioDaSessao();
  if (eu.perfil !== 'admin') notFound();
  const usuarios = await usuariosDoAdmin();
  const nomes = new Map(eu.empresas.map((empresa) => [empresa.slug, empresa.nome]));
  const { opcoes, fixa } = opcoesDeEmpresa(eu.empresas);

  return (
    <div className="pagina">
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
                  <th>Perfil</th>
                  <th>Empresas</th>
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
                    <td>{ROTULOS_PERFIL[usuario.perfil]}</td>
                    <td>{usuario.empresas.map((slug) => nomes.get(slug) ?? slug).join(', ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <div className="card">
        <h2>Novo usuário</h2>
        <FormNovoUsuario empresas={opcoes} empresaFixa={fixa} />
      </div>
    </div>
  );
}
