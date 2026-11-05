'use client';

import {
  acaoDoStatus,
  COMENTARIO_TAREFA_MAX,
  EsquemaErro,
  ROTULOS_STATUS_TAREFA,
  STATUS_TAREFA,
  type StatusTarefa,
  type Tarefa,
} from '@plataforma/contratos';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

type Props = { empresa: string; tarefa: Pick<Tarefa, 'id' | 'status' | 'arteId'> };

async function mensagemDe(resposta: Response, padrao: string): Promise<string> {
  const falha = EsquemaErro.safeParse(await resposta.json().catch(() => null));
  return falha.success ? falha.data.erro.mensagem : padrao;
}

// Mudança de status (Concluída sem arte leva ao formulário da arte) e novo comentário; depois de cada ação,
// a página é recarregada do servidor.
export function AcoesTarefa({ empresa, tarefa }: Props) {
  const roteador = useRouter();
  const base = `/api/v1/empresas/${encodeURIComponent(empresa)}/tarefas/${tarefa.id}`;
  const [status, setStatus] = useState<StatusTarefa>(tarefa.status);
  const [texto, setTexto] = useState('');
  const [erroStatus, setErroStatus] = useState('');
  const [erroComentario, setErroComentario] = useState('');
  const [ocupado, setOcupado] = useState(false);

  async function chamar(caminho: string, metodo: 'PATCH' | 'POST', corpo: unknown) {
    const resposta = await fetch(`${base}${caminho}`, {
      method: metodo,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(corpo),
    });
    if (resposta.status === 401) window.location.assign('/entrar');
    return resposta;
  }

  async function mudarStatus(novo: StatusTarefa) {
    const acao = acaoDoStatus(novo, tarefa);
    if (acao === 'nada') return;
    if (acao === 'pedir_arte') {
      roteador.push(`/${empresa}/artes/tarefas/${tarefa.id}/concluir`);
      return;
    }
    setStatus(novo);
    setErroStatus('');
    setOcupado(true);
    try {
      const resposta = await chamar('/status', 'PATCH', { status: novo });
      if (!resposta.ok) {
        setStatus(tarefa.status);
        setErroStatus(await mensagemDe(resposta, 'Não foi possível mudar o status.'));
        return;
      }
      roteador.refresh();
    } catch {
      setStatus(tarefa.status);
      setErroStatus('Sem conexão com o servidor. Tente novamente.');
    } finally {
      setOcupado(false);
    }
  }

  async function comentar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    if (!texto.trim()) {
      setErroComentario('Escreva o comentário.');
      return;
    }
    setErroComentario('');
    setOcupado(true);
    try {
      const resposta = await chamar('/comentarios', 'POST', { texto });
      if (!resposta.ok) {
        setErroComentario(await mensagemDe(resposta, 'Não foi possível comentar.'));
        return;
      }
      setTexto('');
      roteador.refresh();
    } catch {
      setErroComentario('Sem conexão com o servidor. Tente novamente.');
    } finally {
      setOcupado(false);
    }
  }

  return (
    <>
      <div className="campo">
        <label htmlFor="status-tarefa">Mudar status</label>
        <select
          id="status-tarefa"
          value={status}
          disabled={ocupado}
          onChange={(e) => void mudarStatus(e.target.value as StatusTarefa)}
        >
          {STATUS_TAREFA.map((s) => (
            <option key={s} value={s}>
              {ROTULOS_STATUS_TAREFA[s]}
            </option>
          ))}
        </select>
        {erroStatus && (
          <div className="erro-campo" role="alert">
            {erroStatus}
          </div>
        )}
      </div>

      <form onSubmit={comentar} className="formulario" noValidate>
        <div className="campo">
          <label htmlFor="comentario">Novo comentário</label>
          <textarea
            id="comentario"
            rows={3}
            maxLength={COMENTARIO_TAREFA_MAX}
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
          />
          {erroComentario && (
            <div className="erro-campo" role="alert">
              {erroComentario}
            </div>
          )}
        </div>
        <div className="actions">
          <button type="submit" disabled={ocupado}>
            Comentar
          </button>
        </div>
      </form>
    </>
  );
}
