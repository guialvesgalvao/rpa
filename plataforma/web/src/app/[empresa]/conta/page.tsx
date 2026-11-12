import { SENHA_MINIMA } from '@plataforma/contratos';
import type { Metadata } from 'next';

import { CampoSenha } from '../../../componentes/CampoSenha';
import { usuarioDaSessao } from '../../../servidor/eu';
import { mensagemTrocaSenha } from '../../../usuarios';

export const metadata: Metadata = {
  title: 'Minha conta · Plataforma RPA',
};

// Minha conta: qualquer usuário logado, sem permissão própria. A troca de senha usa a mesma rota do primeiro
// acesso (`/api/sessao/senha`), que volta para cá; a sessão deste navegador continua aberta.
export default async function MinhaConta({ params, searchParams }: PageProps<'/[empresa]/conta'>) {
  const { empresa } = await params;
  const { erro, ok } = await searchParams;
  const eu = await usuarioDaSessao();
  const mensagem = mensagemTrocaSenha(erro);

  return (
    <div className="pagina">
      <div className="card">
        <h2>Minha conta</h2>
        <p className="conta-nome">{eu.nome}</p>
        <div className="hint">{eu.email}</div>
      </div>

      <div className="card">
        <h2>Trocar senha</h2>
        {ok === '1' && !mensagem && (
          <p className="sucesso" role="status">
            Senha alterada.
          </p>
        )}
        {mensagem && (
          <p className="aviso" role="alert">
            {mensagem}
          </p>
        )}
        {/* POST: as senhas nunca vão na URL. */}
        <form method="post" action="/api/sessao/senha" className="formulario">
          <input type="hidden" name="retorno" value="conta" />
          <input type="hidden" name="empresa" value={empresa} />
          <input type="hidden" name="email" value={eu.email} autoComplete="username" />
          <div className="campo">
            <label htmlFor="senhaAtual">Senha atual</label>
            <CampoSenha
              id="senhaAtual"
              name="senhaAtual"
              autoComplete="current-password"
              required
            />
          </div>
          <div className="campo">
            <label htmlFor="novaSenha">Nova senha</label>
            <CampoSenha
              id="novaSenha"
              name="novaSenha"
              autoComplete="new-password"
              minLength={SENHA_MINIMA}
              required
            />
            <div className="hint">
              Ao menos {SENHA_MINIMA} caracteres. As sessões abertas em outros lugares serão
              encerradas.
            </div>
          </div>
          <div className="campo">
            <label htmlFor="confirmacao">Confirmar nova senha</label>
            <CampoSenha
              id="confirmacao"
              name="confirmacao"
              autoComplete="new-password"
              minLength={SENHA_MINIMA}
              required
            />
          </div>
          <div className="actions">
            <button type="submit" className="primary">
              Trocar senha
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
