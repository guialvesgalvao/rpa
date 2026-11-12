import { paginasVisiveis, RETICENCIAS } from '@plataforma/contratos';
import Link from 'next/link';

// Sem 'use client': serve à lista de clientes (client component, `aoEscolher`) e à de usuários (server
// component, `hrefDaPagina`, links `?pagina=N`).
type Navegacao =
  | { aoEscolher: (pagina: number) => void; hrefDaPagina?: never }
  | { hrefDaPagina: (pagina: number) => string; aoEscolher?: never };

type Props = Navegacao & {
  paginaAtual: number;
  totalPaginas: number;
  total: number;
  // Plural do que é listado ("clientes", "usuários").
  rotulo: string;
};

// `‹ Anterior 1 … 4 5 6 … 9 Próxima ›`, com a página atual destacada e o total de itens. Some com uma
// página só.
export function Paginacao({ paginaAtual, totalPaginas, total, rotulo, ...navegacao }: Props) {
  if (totalPaginas <= 1) return null;

  function controle(pagina: number, conteudo: string, rotuloAcessivel?: string) {
    const atual = pagina === paginaAtual;
    const fora = pagina < 1 || pagina > totalPaginas;
    if (navegacao.hrefDaPagina) {
      if (fora || atual) {
        return (
          <span aria-current={atual ? 'page' : undefined} aria-disabled={fora || undefined}>
            {conteudo}
          </span>
        );
      }
      return (
        <Link href={navegacao.hrefDaPagina(pagina)} aria-label={rotuloAcessivel}>
          {conteudo}
        </Link>
      );
    }
    return (
      <button
        type="button"
        disabled={fora}
        aria-current={atual ? 'page' : undefined}
        aria-label={rotuloAcessivel}
        onClick={() => {
          if (!atual) navegacao.aoEscolher(pagina);
        }}
      >
        {conteudo}
      </button>
    );
  }

  return (
    <nav className="paginacao" aria-label={`Páginas de ${rotulo}`}>
      <ul>
        <li>{controle(paginaAtual - 1, '‹ Anterior')}</li>
        {paginasVisiveis(paginaAtual, totalPaginas).map((item, indice) => (
          <li key={item === RETICENCIAS ? `reticencias-${indice}` : item}>
            {item === RETICENCIAS ? (
              <span className="hint">{RETICENCIAS}</span>
            ) : (
              controle(item, String(item), `Página ${item}`)
            )}
          </li>
        ))}
        <li>{controle(paginaAtual + 1, 'Próxima ›')}</li>
      </ul>
      <p className="hint" role="status">
        Página {paginaAtual} de {totalPaginas} · {total} {rotulo}
      </p>
    </nav>
  );
}
