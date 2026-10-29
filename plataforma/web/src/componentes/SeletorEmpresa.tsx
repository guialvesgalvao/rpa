import type { Empresa } from '../empresas';

// Lista aberta pelo nome da empresa atual. Escolher envia o formulário para a rota que grava `rpa_empresa`
// e redireciona; funciona sem JavaScript.
export function SeletorEmpresa({ atual, empresas }: { atual: Empresa; empresas: Empresa[] }) {
  return (
    <details className="seletor">
      <summary aria-label={`Empresa: ${atual.nome}. Trocar de empresa`}>{atual.nome}</summary>
      <form method="post" action="/api/sessao/empresa">
        {empresas.map((empresa) => (
          <button
            key={empresa.slug}
            type="submit"
            name="empresa"
            value={empresa.slug}
            aria-current={empresa.slug === atual.slug ? 'true' : undefined}
          >
            {empresa.nome}
          </button>
        ))}
      </form>
    </details>
  );
}
