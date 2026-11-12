'use client';

import Link from 'next/link';
import { useSelectedLayoutSegment } from 'next/navigation';

import { logoDaEmpresa, type Empresa } from '../empresas';
import { itensDoMenu } from '../modulos';
import { SeletorEmpresa } from './SeletorEmpresa';

// Topo com a empresa atual (seletor só para quem tem mais de uma), as abas e, no rodapé, o usuário (abre a
// Minha conta) e Sair.
// Em telas estreitas vira uma barra no topo (`globals.css`).
export function MenuLateral({
  atual,
  empresas,
  usuario,
  permissoes,
}: {
  atual: Empresa;
  empresas: Empresa[];
  usuario: string;
  // As permissões do usuário na empresa atual: decidem as abas (`modulos.ts`).
  permissoes: string[];
}) {
  const segmento = useSelectedLayoutSegment();
  const logo = logoDaEmpresa(atual.slug);

  return (
    <aside className="menu">
      <div className="menu-topo">
        {logo && <img src={logo} alt="" />}
        {empresas.length > 1 ? (
          <SeletorEmpresa atual={atual} empresas={empresas} />
        ) : (
          <strong className="menu-empresa">{atual.nome}</strong>
        )}
      </div>

      <nav className="menu-itens" aria-label="Abas">
        {itensDoMenu(permissoes, atual.slug).map((item) => (
          <Link
            key={item.segmento}
            href={`/${atual.slug}/${item.segmento}`}
            aria-current={segmento === item.segmento ? 'page' : undefined}
          >
            {item.rotulo}
          </Link>
        ))}
      </nav>

      <div className="menu-rodape">
        <Link
          className="usuario"
          href={`/${atual.slug}/conta`}
          title="Minha conta"
          aria-current={segmento === 'conta' ? 'page' : undefined}
        >
          {usuario}
        </Link>
        <form method="post" action="/api/sessao/sair">
          <button type="submit">Sair</button>
        </form>
      </div>
    </aside>
  );
}
