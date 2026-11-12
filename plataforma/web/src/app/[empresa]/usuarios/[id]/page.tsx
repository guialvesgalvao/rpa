import { rotuloArea, temPermissao } from '@plataforma/contratos';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { ExcluirUsuario } from '../../../../componentes/ExcluirUsuario';
import { FormRedefinirSenha } from '../../../../componentes/FormRedefinirSenha';
import { FormUsuario } from '../../../../componentes/FormUsuario';
import { PainelPermissoes } from '../../../../componentes/PainelPermissoes';
import { exigirPermissaoNaPagina } from '../../../../servidor/eu';
import { usuarioDaEmpresa } from '../../../../servidor/usuarios';
import { empresasCom } from '../../../../usuarios';

export const metadata: Metadata = {
  title: 'Usuário · Plataforma RPA',
};

// Um usuário da empresa: dados (quem pode editar usuários em todas as empresas dele), permissões (um bloco por
// empresa em que quem abre pode editar permissões), redefinição de senha e exclusão.
export default async function PaginaUsuario({ params }: PageProps<'/[empresa]/usuarios/[id]'>) {
  const { empresa, id } = await params;
  const { eu, permissoes } = await exigirPermissaoNaPagina(empresa, 'usuarios');
  const podeEditar = temPermissao(permissoes, 'usuarios.editar');
  if (!podeEditar && !temPermissao(permissoes, 'usuarios.permissoes')) notFound();
  const usuario = await usuarioDaEmpresa(empresa, id);

  const editaveis = empresasCom(eu, 'usuarios.editar');
  // Nome, e-mail, área, empresas e a exclusão valem para o usuário inteiro.
  const emTodas = usuario.empresas.every((e) => editaveis.some((minha) => minha.slug === e.slug));
  const comPermissoes = empresasCom(eu, 'usuarios.permissoes').filter((minha) =>
    usuario.empresas.some((e) => e.slug === minha.slug),
  );
  const ehEuMesmo = usuario.id === eu.id;

  return (
    <div className="pagina">
      <p>
        <Link href={`/${empresa}/usuarios`}>← Usuários</Link>
      </p>
      <div className="card">
        <h2>{usuario.nome}</h2>
        <div className="hint">
          {usuario.email} · {rotuloArea(usuario.area)}
          {!usuario.ativo && ' · inativo'}
        </div>
      </div>

      {podeEditar && (
        <div className="card">
          <h2>Dados</h2>
          {emTodas ? (
            <FormUsuario
              empresa={empresa}
              empresas={editaveis}
              empresasComPermissoes={[]}
              usuario={usuario}
            />
          ) : (
            <p className="hint">
              Este usuário também pertence a uma empresa em que você não pode editar usuários. Os
              dados e a exclusão ficam com quem administra todas as empresas dele.
            </p>
          )}
        </div>
      )}

      {comPermissoes.map((minha) => (
        <div className="card" key={minha.slug}>
          <h2>Permissões</h2>
          <PainelPermissoes
            empresa={minha.slug}
            nomeEmpresa={minha.nome}
            usuarioId={usuario.id}
            iniciais={usuario.empresas.find((e) => e.slug === minha.slug)?.permissoes ?? []}
          />
        </div>
      ))}

      {podeEditar && emTodas && !ehEuMesmo && (
        <div className="card">
          <h2>Redefinir senha</h2>
          <FormRedefinirSenha empresa={empresa} usuarioId={usuario.id} />
        </div>
      )}

      {podeEditar && emTodas && !ehEuMesmo && (
        <div className="card">
          <h2>Excluir</h2>
          <ExcluirUsuario empresa={empresa} usuarioId={usuario.id} nome={usuario.nome} />
        </div>
      )}
    </div>
  );
}
