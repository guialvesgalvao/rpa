import type { Metadata } from 'next';

import { destinoSeguro } from '../../servidor/sessao';

export const metadata: Metadata = {
  title: 'Entrar · Plataforma RPA',
};

// Antes do login a empresa não é conhecida: a página usa o tema neutro e não mostra logo.
export default async function Entrar({ searchParams }: PageProps<'/entrar'>) {
  const { erro, destino } = await searchParams;
  const destinoValido = destinoSeguro(destino);

  return (
    <>
      <header>
        <div className="titulo">
          <h1>Artes</h1>
          <p>Plataforma RPA</p>
        </div>
      </header>

      <main>
        <div className="pagina entrar">
          <div className="card">
            <h2>Entrar</h2>
            {/* A mesma mensagem para qualquer recusa: não revela se o e-mail tem conta. */}
            {erro !== undefined && (
              <p className="aviso" role="alert">
                E-mail ou senha inválidos.
              </p>
            )}
            {/* POST: as credenciais nunca vão na URL. */}
            <form method="post" action="/api/sessao/entrar">
              {destinoValido && <input type="hidden" name="destino" value={destinoValido} />}
              <div className="campo">
                <label htmlFor="email">E-mail</label>
                <input id="email" name="email" type="email" autoComplete="username" required />
              </div>
              <div className="campo">
                <label htmlFor="senha">Senha</label>
                <input
                  id="senha"
                  name="senha"
                  type="password"
                  autoComplete="current-password"
                  required
                />
              </div>
              <div className="actions">
                <button type="submit" className="primary">
                  Entrar
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
