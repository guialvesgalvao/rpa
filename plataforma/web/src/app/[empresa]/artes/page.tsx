import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Artes · Plataforma RPA',
};

// O cadastro de artes entra no plano D.
export default function Artes() {
  return (
    <div className="pagina">
      <div className="card">
        <h2>Artes</h2>
        <div className="hint">
          <span className="em-breve">Em breve</span> Cadastro de artes ainda não disponível.
        </div>
      </div>
    </div>
  );
}
