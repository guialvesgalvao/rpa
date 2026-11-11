'use client';

import {
  type AcoesPermitidas,
  ANEXOS_POR_COMENTARIO,
  COMENTARIO_COMPRA_MAX,
  EsquemaErro,
  type Insumo,
  type PedidoCompra,
  ROTULOS_STATUS_COMPRA,
  STATUS_COMPRA,
  type StatusCompra,
} from '@plataforma/contratos';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

import { ACEITOS_ANEXO, problemaDosAnexos } from '../anexos';
import { FormPedido } from './FormPedido';

type Props = {
  empresa: string;
  pedido: Pick<PedidoCompra, 'id' | 'status' | 'insumo' | 'quantidade' | 'observacao'>;
  acoes: AcoesPermitidas;
  insumos: Insumo[];
};

async function mensagemDe(resposta: Response, padrao: string): Promise<string> {
  const falha = EsquemaErro.safeParse(await resposta.json().catch(() => null));
  return falha.success ? falha.data.erro.mensagem : padrao;
}

// Assumir, mudar o status, cancelar, editar e comentar, conforme o que `acoesDoPedido` liberou; depois de cada
// ação, a página é recarregada do servidor.
export function AcoesPedido({ empresa, pedido, acoes, insumos }: Props) {
  const roteador = useRouter();
  const base = `/api/v1/empresas/${encodeURIComponent(empresa)}/compras/pedidos/${pedido.id}`;
  const [status, setStatus] = useState<StatusCompra>(pedido.status);
  const [editando, setEditando] = useState(false);
  const [texto, setTexto] = useState('');
  const [anexos, setAnexos] = useState<File[]>([]);
  // Muda a cada envio: remonta o campo de arquivos vazio.
  const [chaveAnexos, setChaveAnexos] = useState(0);
  const [erroAcao, setErroAcao] = useState('');
  const [erroComentario, setErroComentario] = useState('');
  const [ocupado, setOcupado] = useState(false);

  async function chamar(caminho: string, metodo: 'PATCH' | 'POST', corpo?: unknown) {
    // FormData vai como multipart (o navegador põe o boundary); o resto, JSON.
    const multipart = corpo instanceof FormData;
    const resposta = await fetch(`${base}${caminho}`, {
      method: metodo,
      ...(corpo === undefined
        ? {}
        : multipart
          ? { body: corpo }
          : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(corpo) }),
    });
    if (resposta.status === 401) window.location.assign('/entrar');
    return resposta;
  }

  async function agir(caminho: string, metodo: 'PATCH' | 'POST', corpo: unknown, falha: string) {
    setErroAcao('');
    setOcupado(true);
    try {
      const resposta = await chamar(caminho, metodo, corpo);
      if (!resposta.ok) {
        setStatus(pedido.status);
        setErroAcao(await mensagemDe(resposta, falha));
        return;
      }
      roteador.refresh();
    } catch {
      setStatus(pedido.status);
      setErroAcao('Sem conexão com o servidor. Tente novamente.');
    } finally {
      setOcupado(false);
    }
  }

  function mudarStatus(novo: StatusCompra) {
    if (novo === pedido.status) return;
    setStatus(novo);
    void agir('/status', 'PATCH', { status: novo }, 'Não foi possível mudar o status.');
  }

  function cancelar() {
    if (!window.confirm('Cancelar este pedido?')) return;
    void agir('/status', 'PATCH', { status: 'cancelada' }, 'Não foi possível cancelar o pedido.');
  }

  async function comentar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    const problema = problemaDosAnexos(texto, anexos);
    if (problema) {
      setErroComentario(problema);
      return;
    }
    setErroComentario('');
    setOcupado(true);
    try {
      let corpo: unknown = { texto };
      if (anexos.length) {
        const form = new FormData();
        form.append('texto', texto);
        for (const anexo of anexos) form.append('anexos', anexo, anexo.name);
        corpo = form;
      }
      const resposta = await chamar('/comentarios', 'POST', corpo);
      if (!resposta.ok) {
        setErroComentario(await mensagemDe(resposta, 'Não foi possível comentar.'));
        return;
      }
      setTexto('');
      setAnexos([]);
      setChaveAnexos((n) => n + 1);
      roteador.refresh();
    } catch {
      setErroComentario('Sem conexão com o servidor. Tente novamente.');
    } finally {
      setOcupado(false);
    }
  }

  return (
    <>
      {(acoes.assumir || acoes.cancelar || acoes.editar) && (
        <div className="actions">
          {acoes.assumir && (
            <button
              type="button"
              className="primary"
              disabled={ocupado}
              onClick={() => void agir('/assumir', 'POST', undefined, 'Não foi possível assumir.')}
            >
              Assumir pedido
            </button>
          )}
          {acoes.editar && !editando && (
            <button type="button" disabled={ocupado} onClick={() => setEditando(true)}>
              Editar pedido
            </button>
          )}
          {acoes.cancelar && (
            <button type="button" disabled={ocupado} onClick={cancelar}>
              Cancelar pedido
            </button>
          )}
        </div>
      )}

      {acoes.mudarStatus && (
        <div className="campo">
          <label htmlFor="status-pedido">Mudar status</label>
          <select
            id="status-pedido"
            value={status}
            disabled={ocupado}
            onChange={(e) => mudarStatus(e.target.value as StatusCompra)}
          >
            {STATUS_COMPRA.map((s) => (
              <option key={s} value={s}>
                {ROTULOS_STATUS_COMPRA[s]}
              </option>
            ))}
          </select>
        </div>
      )}
      {erroAcao && (
        <div className="erro-campo" role="alert">
          {erroAcao}
        </div>
      )}

      {editando && (
        <div className="edicao-pedido">
          <h3>Editar pedido</h3>
          <FormPedido
            empresa={empresa}
            insumos={insumos}
            pedido={pedido}
            aoSalvar={() => setEditando(false)}
          />
          <div className="actions">
            <button type="button" onClick={() => setEditando(false)}>
              Descartar alterações
            </button>
          </div>
        </div>
      )}

      <form onSubmit={comentar} className="formulario" noValidate>
        <div className="campo">
          <label htmlFor="comentario">Novo comentário</label>
          <textarea
            id="comentario"
            rows={3}
            maxLength={COMENTARIO_COMPRA_MAX}
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
          />
          <label htmlFor="anexos-comentario" className="rotulo-secundario">
            Anexos (PDF ou imagem, até {ANEXOS_POR_COMENTARIO})
          </label>
          <input
            key={chaveAnexos}
            id="anexos-comentario"
            type="file"
            multiple
            accept={ACEITOS_ANEXO}
            onChange={(e) => setAnexos(Array.from(e.target.files ?? []))}
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
