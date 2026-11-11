import {
  acoesDoPedido,
  formatarQuantidade,
  rotuloArea,
  rotuloInsumo,
  ROTULOS_STATUS_COMPRA,
  temPermissao,
} from '@plataforma/contratos';
import type { Metadata } from 'next';
import Link from 'next/link';

import { formatarTamanho } from '../../../../anexos';
import { AcoesPedido } from '../../../../componentes/AcoesPedido';
import { formatarDataHora } from '../../../../datas';
import { insumosDaEmpresa, pedidoDaEmpresa } from '../../../../servidor/compras';
import { exigirPermissaoNaPagina } from '../../../../servidor/eu';

export const metadata: Metadata = {
  title: 'Pedido de compra · Plataforma RPA',
};

export default async function PaginaPedido({
  params,
  searchParams,
}: PageProps<'/[empresa]/compras/[id]'>) {
  const { empresa, id } = await params;
  const consulta = await searchParams;
  const { eu, permissoes } = await exigirPermissaoNaPagina(empresa, 'compras');
  const pedido = await pedidoDaEmpresa(empresa, id);
  const acoes = acoesDoPedido(pedido, eu.id, permissoes);
  // A lista de insumos é de quem pode pedir; sem ela, a edição mantém o insumo.
  const insumos =
    acoes.editar && temPermissao(permissoes, 'compras.pedir')
      ? await insumosDaEmpresa(empresa)
      : [];

  return (
    <div className="pagina">
      <p>
        <Link href={`/${empresa}/compras`}>← Compras</Link>
      </p>
      {consulta.criado !== undefined && (
        <p className="sucesso" role="status">
          Pedido criado
        </p>
      )}
      <div className="card">
        <h2>{rotuloInsumo(pedido.insumo)}</h2>
        <dl className="info-tarefa">
          <dt>Quantidade</dt>
          <dd>{formatarQuantidade(pedido.quantidade)}</dd>
          <dt>Observação</dt>
          <dd className="texto-comentario">{pedido.observacao ?? '—'}</dd>
          <dt>Criado por</dt>
          <dd>{pedido.criador?.nome ?? 'Usuário removido'}</dd>
          <dt>Área</dt>
          <dd>{rotuloArea(pedido.areaCriador)}</dd>
          <dt>Criado em</dt>
          <dd>{formatarDataHora(pedido.criadoEm)}</dd>
          <dt>Atualizado em</dt>
          <dd>{formatarDataHora(pedido.atualizadoEm)}</dd>
          <dt>Responsável</dt>
          <dd>{pedido.responsavel?.nome ?? 'Sem responsável'}</dd>
          <dt>Status</dt>
          <dd>
            <span className="selo-compra" data-status={pedido.status}>
              {ROTULOS_STATUS_COMPRA[pedido.status]}
            </span>
          </dd>
        </dl>
        <div className="actions">
          <Link className="botao" href={`/${empresa}/compras/${pedido.id}/historico`}>
            Histórico
          </Link>
        </div>
        {/* `key`: o estado dos campos volta ao do servidor depois de cada atualização. */}
        <AcoesPedido
          key={pedido.atualizadoEm}
          empresa={empresa}
          pedido={pedido}
          acoes={acoes}
          insumos={insumos}
        />
      </div>
      <div className="card">
        <h2>Comentários</h2>
        {pedido.comentarios.length === 0 ? (
          <div className="hint">Nenhum comentário ainda.</div>
        ) : (
          <ul className="comentarios">
            {pedido.comentarios.map((comentario) => (
              <li key={comentario.id}>
                <div className="hint">
                  {comentario.autor?.nome ?? 'Usuário removido'} ·{' '}
                  {formatarDataHora(comentario.criadoEm)}
                </div>
                {comentario.texto && <div className="texto-comentario">{comentario.texto}</div>}
                {comentario.anexos.length > 0 && (
                  <ul className="anexos-comentario">
                    {comentario.anexos.map((anexo) => (
                      <li key={anexo.id}>
                        <a
                          href={`/api/v1/empresas/${encodeURIComponent(empresa)}/compras/pedidos/${pedido.id}/comentarios/${comentario.id}/anexos/${anexo.id}`}
                          download={anexo.nome}
                        >
                          {anexo.nome}
                        </a>{' '}
                        <span className="hint">({formatarTamanho(anexo.tamanho)})</span>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
