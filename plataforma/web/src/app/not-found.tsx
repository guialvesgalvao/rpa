import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Página não encontrada · Plataforma RPA',
};

// Também para empresa sem acesso: a resposta não diferencia empresa alheia de inexistente.
export default function NaoEncontrada() {
  return (
    <>
      <header>
        <div className="titulo">
          <h1>Página não encontrada</h1>
          <p>Plataforma RPA</p>
        </div>
      </header>

      <main>
        <div className="pagina">
          <div className="card">
            <h2>Página não encontrada</h2>
            <p>O endereço não existe ou você não tem acesso a esta empresa.</p>
            {/* `<a>`: recarrega a página inteira e passa pela guarda do `proxy.ts`. */}
            <a href="/entrar">Voltar ao início</a>
          </div>
        </div>
      </main>

      <footer>Plataforma RPA</footer>
    </>
  );
}
