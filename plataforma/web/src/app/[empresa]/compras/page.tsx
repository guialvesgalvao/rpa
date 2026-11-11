import {
  escoposDaLista,
  formatarQuantidade,
  rotuloArea,
  rotuloInsumo,
  ROTULOS_STATUS_COMPRA,
  STATUS_COMPRA,
  temPermissao,
} from '@plataforma/contratos';
import type { Metadata } from 'next';
import Link from 'next/link';

import { consultaDaLista } from '../../../compras';
import { formatarDataHora } from '../../../datas';
import { pedidosDaEmpresa } from '../../../servidor/compras';
import { exigirPermissaoNaPagina } from '../../../servidor/eu';

export const metadata: Metadata = {
  title: 'Compras · Plataforma RPA',
};

// Pedidos de compra de insumos, com o filtro de escopo e de status num GET simples. Quem não acompanha todos os
// pedidos só vê os próprios (a API decide), qualquer que seja o escopo.
export default async function Compras({ params, searchParams }: PageProps<'/[empresa]/compras'>) {
  const { empresa } = await params;
  const busca = await searchParams;
  const { permissoes } = await exigirPermissaoNaPagina(empresa, 'compras');
  const escopos = escoposDaLista(permissoes);
  const consulta = consultaDaLista(permissoes, busca);
  const pedidos = await pedidosDaEmpresa(empresa, consulta);
  const podePedir = temPermissao(permissoes, 'compras.pedir');

  return (
    <div className="pagina">
      <div className="card">
        <h2>Pedidos de compra</h2>
        {podePedir && (
          <div className="actions">
            <Link className="botao primary" href={`/${empresa}/compras/novo`}>
              Novo pedido
            </Link>
          </div>
        )}
        <form className="filtro" method="get">
          <label htmlFor="escopo">Pedidos</label>
          <select id="escopo" name="escopo" defaultValue={consulta.escopo}>
            {escopos.map((opcao) => (
              <option key={opcao.valor} value={opcao.valor}>
                {opcao.rotulo}
              </option>
            ))}
          </select>
          <label htmlFor="status">Status</label>
          <select id="status" name="status" defaultValue={consulta.status ?? ''}>
            <option value="">Todos os status</option>
            {STATUS_COMPRA.map((status) => (
              <option key={status} value={status}>
                {ROTULOS_STATUS_COMPRA[status]}
              </option>
            ))}
          </select>
          <button type="submit">Filtrar</button>
        </form>
        {pedidos.length === 0 ? (
          <div className="hint">Nenhum pedido encontrado.</div>
        ) : (
          <div className="tabela-rolagem">
            <table className="tabela">
              <thead>
                <tr>
                  <th>Insumo</th>
                  <th>Quantidade</th>
                  <th>Criado por</th>
                  <th>Área</th>
                  <th>Data</th>
                  <th>Responsável</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {pedidos.map((pedido) => (
                  <tr key={pedido.id}>
                    <td>
                      <Link href={`/${empresa}/compras/${pedido.id}`}>
                        {rotuloInsumo(pedido.insumo)}
                      </Link>
                    </td>
                    <td>{formatarQuantidade(pedido.quantidade)}</td>
                    <td>{pedido.criador?.nome ?? 'Usuário removido'}</td>
                    <td>{rotuloArea(pedido.areaCriador)}</td>
                    <td>{formatarDataHora(pedido.criadoEm)}</td>
                    <td>{pedido.responsavel?.nome ?? 'Sem responsável'}</td>
                    <td>
                      <span className="selo-compra" data-status={pedido.status}>
                        {ROTULOS_STATUS_COMPRA[pedido.status]}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
