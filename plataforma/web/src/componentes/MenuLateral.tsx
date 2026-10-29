'use client';

import Link from 'next/link';
import { useSelectedLayoutSegment } from 'next/navigation';

import { logoDaEmpresa, type Empresa } from '../empresas';
import { SeletorEmpresa } from './SeletorEmpresa';

// As abas do site; Configurações e as automações do app desktop não entram aqui.
const ITENS = [{ segmento: 'artes', rotulo: 'Artes' }];

// Topo com a empresa atual (seletor só para quem tem mais de uma), as abas e, no rodapé, o usuário e Sair.
// Em telas estreitas vira uma barra no topo (`globals.css`).
export function MenuLateral({
  atual,
  empresas,
  usuario,
}: {
  atual: Empresa;
  empresas: Empresa[];
  usuario: string;
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
        {ITENS.map((item) => (
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
        <span className="usuario">{usuario}</span>
        <form method="post" action="/api/sessao/sair">
          <button type="submit">Sair</button>
        </form>
      </div>
    </aside>
  );
}
