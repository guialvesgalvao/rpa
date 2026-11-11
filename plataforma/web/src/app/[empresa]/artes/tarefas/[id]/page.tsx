import {
  temPermissao,
  precisaDaArteParaConcluir,
  ROTULOS_STATUS_TAREFA,
  tituloTarefa,
} from '@plataforma/contratos';
import type { Metadata } from 'next';
import Link from 'next/link';

import { formatarTamanho } from '../../../../../anexos';
import { AcoesTarefa } from '../../../../../componentes/AcoesTarefa';
import { formatarDataHora } from '../../../../../datas';
import { tarefaDaEmpresa } from '../../../../../servidor/artes';
import { exigirPermissaoNaPagina } from '../../../../../servidor/eu';

export const metadata: Metadata = {
  title: 'Tarefa de arte · Plataforma RPA',
};

const MENSAGENS: Record<string, string> = {
  criada: 'Tarefa criada',
  concluida: 'Tarefa concluída e arte cadastrada',
};

export default async function PaginaTarefa({
  params,
  searchParams,
}: PageProps<'/[empresa]/artes/tarefas/[id]'>) {
  const { empresa, id } = await params;
  const consulta = await searchParams;
  const { permissoes } = await exigirPermissaoNaPagina(empresa, 'artes');
  const podeConcluir = temPermissao(permissoes, 'artes.adicionar');
  const tarefa = await tarefaDaEmpresa(empresa, id);
  const mensagem = Object.keys(MENSAGENS).find((chave) => consulta[chave] !== undefined);

  return (
    <div className="pagina">
      <p>
        <Link href={`/${empresa}/artes/tarefas`}>← Tarefas</Link>
      </p>
      {mensagem && (
        <p className="sucesso" role="status">
          {MENSAGENS[mensagem]}
        </p>
      )}
      <div className="card">
        <h2>{tituloTarefa(tarefa)}</h2>
        <dl className="info-tarefa">
          <dt>Cliente</dt>
          <dd>
            <Link href={`/${empresa}/artes/clientes/${tarefa.cliente.id}`}>
              {tarefa.cliente.nome}
            </Link>
          </dd>
          <dt>Produto</dt>
          <dd>{tarefa.produto.nome}</dd>
          <dt>Responsável</dt>
          <dd>{tarefa.responsavel?.nome ?? 'Usuário removido'}</dd>
          <dt>Criada em</dt>
          <dd>{formatarDataHora(tarefa.criadoEm)}</dd>
          <dt>Atualizada em</dt>
          <dd>{formatarDataHora(tarefa.atualizadoEm)}</dd>
          <dt>Status</dt>
          <dd>
            <span className="selo-tarefa" data-status={tarefa.status}>
              {ROTULOS_STATUS_TAREFA[tarefa.status]}
            </span>
          </dd>
          <dt>Arte</dt>
          <dd>
            {tarefa.arteId
              ? 'Cadastrada na conclusão'
              : 'Ainda não cadastrada (exigida para concluir)'}
          </dd>
        </dl>
        <div className="actions">
          {podeConcluir && precisaDaArteParaConcluir(tarefa) && (
            <Link
              className="botao primary"
              href={`/${empresa}/artes/tarefas/${tarefa.id}/concluir`}
            >
              Concluir com a arte
            </Link>
          )}
          <Link className="botao" href={`/${empresa}/artes/tarefas/${tarefa.id}/historico`}>
            Histórico
          </Link>
        </div>
        {/* `key`: o estado do seletor volta ao status do servidor depois de cada atualização. */}
        <AcoesTarefa
          key={tarefa.atualizadoEm}
          empresa={empresa}
          tarefa={tarefa}
          podeConcluir={podeConcluir}
        />
      </div>
      <div className="card">
        <h2>Comentários</h2>
        {tarefa.comentarios.length === 0 ? (
          <div className="hint">Nenhum comentário ainda.</div>
        ) : (
          <ul className="comentarios">
            {tarefa.comentarios.map((comentario) => (
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
                          href={`/api/v1/empresas/${encodeURIComponent(empresa)}/tarefas/${tarefa.id}/comentarios/${comentario.id}/anexos/${anexo.id}`}
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
