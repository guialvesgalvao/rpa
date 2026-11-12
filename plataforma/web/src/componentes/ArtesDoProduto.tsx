'use client';

import {
  EsquemaArteDoProduto,
  rotuloArtes,
  type ArteDoProduto,
  type ProdutoDoCliente,
} from '@plataforma/contratos';
import { useEffect, useRef, useState } from 'react';
import { z } from 'zod';

import { formatarDataHora } from '../datas';

const EsquemaArtes = z.array(EsquemaArteDoProduto);

type Carga =
  { status: 'fechado' | 'carregando' | 'erro' } | { status: 'pronto'; artes: ArteDoProduto[] };

type Props = { empresa: string; clienteId: string; produto: ProdutoDoCliente };

// Um produto do perfil do cliente: clicar abre a lista das artes dele (buscada só na primeira abertura) e cada
// arte com imagem abre a imagem num modal. Arte só com PDF mostra "Sem imagem".
export function ArtesDoProduto({ empresa, clienteId, produto }: Props) {
  const [aberto, setAberto] = useState(false);
  const [carga, setCarga] = useState<Carga>({ status: 'fechado' });
  const [vendo, setVendo] = useState<ArteDoProduto | null>(null);
  const idLista = `artes-${produto.id}`;

  // Busca quando abre pela primeira vez (ou ao tentar de novo, que volta a carga para "fechado"); fechar e
  // reabrir reaproveita a lista. Fechar no meio da carga a cancela, e reabrir busca de novo.
  const precisaCarregar = aberto && (carga.status === 'fechado' || carga.status === 'carregando');
  useEffect(() => {
    if (!precisaCarregar) return;
    const controle = new AbortController();
    setCarga({ status: 'carregando' });
    void (async () => {
      try {
        const resposta = await fetch(
          `/api/v1/empresas/${encodeURIComponent(empresa)}/clientes/${encodeURIComponent(clienteId)}/produtos/${encodeURIComponent(produto.id)}/artes`,
          { signal: controle.signal },
        );
        if (resposta.status === 401) {
          window.location.assign('/entrar');
          return;
        }
        if (!resposta.ok) throw new Error(`HTTP ${resposta.status}`);
        setCarga({ status: 'pronto', artes: EsquemaArtes.parse(await resposta.json()) });
      } catch {
        if (!controle.signal.aborted) setCarga({ status: 'erro' });
      }
    })();
    return () => controle.abort();
  }, [precisaCarregar, empresa, clienteId, produto.id]);

  return (
    <li className="produto-com-artes">
      <button
        type="button"
        className="produto-cabecalho"
        aria-expanded={aberto}
        aria-controls={idLista}
        onClick={() => setAberto((valor) => !valor)}
      >
        <span>{produto.nome}</span>
        <span className="status pendente">{rotuloArtes(produto.quantidadeArtes)}</span>
      </button>
      {aberto && (
        <div id={idLista} className="artes-do-produto">
          {carga.status === 'carregando' && (
            <div className="hint" role="status">
              Carregando…
            </div>
          )}
          {carga.status === 'erro' && (
            <div className="aviso" role="alert">
              Não foi possível carregar as artes.{' '}
              <button type="button" onClick={() => setCarga({ status: 'fechado' })}>
                Tentar de novo
              </button>
            </div>
          )}
          {carga.status === 'pronto' &&
            (carga.artes.length === 0 ? (
              <div className="hint">Nenhuma arte cadastrada para este produto.</div>
            ) : (
              <ul aria-label={`Artes de ${produto.nome}`}>
                {carga.artes.map((arte) => (
                  <li key={arte.id}>
                    <div>
                      <strong>{arte.nome}</strong>
                      <div className="hint">
                        {arte.cor.nome}
                        {arte.maquinas.length > 0 &&
                          ` · ${arte.maquinas.map((m) => m.nome).join(', ')}`}
                        {` · ${formatarDataHora(arte.criadoEm)}`}
                      </div>
                    </div>
                    {arte.temImagem ? (
                      <button type="button" onClick={() => setVendo(arte)}>
                        Visualizar imagem
                      </button>
                    ) : (
                      <span className="hint">Sem imagem</span>
                    )}
                  </li>
                ))}
              </ul>
            ))}
        </div>
      )}
      {vendo && <ModalImagem empresa={empresa} arte={vendo} aoFechar={() => setVendo(null)} />}
    </li>
  );
}

// Modal nativo (`<dialog>`): fecha pelo botão, pelo Esc e pelo clique fora da imagem. A imagem vem pelo BFF
// (cookie de sessão), por isso `<img>` e não `next/image`, cujo otimizador não leva a sessão.
function ModalImagem({
  empresa,
  arte,
  aoFechar,
}: {
  empresa: string;
  arte: ArteDoProduto;
  aoFechar: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [falhou, setFalhou] = useState(false);

  // Sem `close()` na limpeza: o evento `close` chegaria depois e fecharia o modal recém-aberto (o Strict Mode
  // monta, desmonta e monta de novo). Ao desmontar, o `<dialog>` sai do DOM e da camada do topo sozinho.
  useEffect(() => {
    const dialogo = ref.current;
    if (dialogo && !dialogo.open) dialogo.showModal();
  }, []);

  return (
    <dialog
      ref={ref}
      className="modal-imagem"
      aria-label={`Imagem da arte ${arte.nome}`}
      onClose={aoFechar}
      onClick={(evento) => {
        // O clique no fundo (fora do conteúdo) chega com o próprio `<dialog>` como alvo.
        if (evento.target === evento.currentTarget) ref.current?.close();
      }}
    >
      <div className="modal-imagem-conteudo">
        <div className="modal-imagem-topo">
          <strong>{arte.nome}</strong>
          <button type="button" onClick={() => ref.current?.close()}>
            Fechar
          </button>
        </div>
        {falhou ? (
          <div className="aviso" role="alert">
            Não foi possível carregar a imagem.
          </div>
        ) : (
          <img
            src={`/api/v1/empresas/${encodeURIComponent(empresa)}/artes/${encodeURIComponent(arte.id)}/imagem`}
            alt={`Arte ${arte.nome}`}
            onError={() => setFalhou(true)}
          />
        )}
      </div>
    </dialog>
  );
}
