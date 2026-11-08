import { SENHA_MINIMA } from '@plataforma/contratos';
import type { Metadata } from 'next';
import { cookies } from 'next/headers';

import { usuarioDaSessao } from '../../servidor/eu';
import { COOKIE_EMPRESA, empresaInicial } from '../../servidor/sessao';
import { mensagemTrocaSenha } from '../../usuarios';

export const metadata: Metadata = {
  title: 'Trocar senha · Plataforma RPA',
};

// Troca da própria senha. Quem entrou com a senha inicial definida pelo admin é trazido para cá pelo layout
// das empresas; depois da troca, volta para a empresa.
export default async function TrocarSenha({ searchParams }: PageProps<'/trocar-senha'>) {
  const { erro } = await searchParams;
  const eu = await usuarioDaSessao();
  const empresa = empresaInicial(eu, (await cookies()).get(COOKIE_EMPRESA)?.value);
  const mensagem = mensagemTrocaSenha(erro);

  return (
    <>
      <header>
        <div className="titulo">
          <h1>Trocar senha</h1>
          <p>Plataforma RPA</p>
        </div>
      </header>

      <main>
        <div className="pagina entrar">
          <div className="card">
            <h2>{eu.deveTrocarSenha ? 'Defina a sua senha' : 'Trocar senha'}</h2>
            {eu.deveTrocarSenha && (
              <p className="hint">
                Você entrou com a senha inicial definida pelo administrador. Escolha uma senha nova
                para continuar.
              </p>
            )}
            {mensagem && (
              <p className="aviso" role="alert">
                {mensagem}
              </p>
            )}
            {/* POST: as senhas nunca vão na URL. */}
            <form method="post" action="/api/sessao/senha">
              {empresa && <input type="hidden" name="empresa" value={empresa} />}
              <input type="hidden" name="email" value={eu.email} autoComplete="username" />
              <div className="campo">
                <label htmlFor="senhaAtual">Senha atual</label>
                <input
                  id="senhaAtual"
                  name="senhaAtual"
                  type="password"
                  autoComplete="current-password"
                  required
                />
              </div>
              <div className="campo">
                <label htmlFor="novaSenha">Nova senha</label>
                <input
                  id="novaSenha"
                  name="novaSenha"
                  type="password"
                  autoComplete="new-password"
                  minLength={SENHA_MINIMA}
                  required
                />
                <div className="hint">Ao menos {SENHA_MINIMA} caracteres.</div>
              </div>
              <div className="campo">
                <label htmlFor="confirmacao">Confirme a nova senha</label>
                <input
                  id="confirmacao"
                  name="confirmacao"
                  type="password"
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
      </main>

      <footer>Plataforma RPA</footer>
    </>
  );
}
