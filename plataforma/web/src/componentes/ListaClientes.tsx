'use client';

import {
  EsquemaPaginaClientes,
  LIMITE_PADRAO_CLIENTES,
  estadoInicialPaginas,
  itensDaPagina,
  redutorPaginas,
  totalDePaginas,
  type Cliente,
} from '@plataforma/contratos';
import Link from 'next/link';
import { useEffect, useReducer, useRef, useState } from 'react';

import { Paginacao } from './Paginacao';

const ESPERA_BUSCA_MS = 300;

// Clientes da empresa com busca (300 ms de espera) e páginas numeradas de 20, uma requisição por página.
// Páginas já vistas ficam em cache; uma busca nova volta à página 1 e cancela a carga anterior.
export function ListaClientes({ empresa }: { empresa: string }) {
  const [estado, despachar] = useReducer(redutorPaginas<Cliente>, undefined, () =>
    estadoInicialPaginas<Cliente>(LIMITE_PADRAO_CLIENTES),
  );
  const [termo, setTermo] = useState('');
  const topo = useRef<HTMLDivElement>(null);
  const paginaAnterior = useRef(estado.pagina);
  // A carga lê o estado mais recente sem entrar nas dependências do efeito.
  const atual = useRef(estado);
  atual.current = estado;

  // Espera o usuário parar de digitar antes de buscar.
  useEffect(() => {
    const espera = setTimeout(
      () => despachar({ tipo: 'busca_alterada', busca: termo.trim() }),
      ESPERA_BUSCA_MS,
    );
    return () => clearTimeout(espera);
  }, [termo]);

  // Uma carga por `requisicao`; trocar de requisição (busca nova, desmontar) aborta a anterior.
  useEffect(() => {
    const { requisicao, busca, pagina, porPagina, status } = atual.current;
    if (status !== 'carregando') return;
    const controle = new AbortController();

    const parametros = new URLSearchParams({ pagina: String(pagina), limite: String(porPagina) });
    if (busca) parametros.set('busca', busca);

    void (async () => {
      try {
        const resposta = await fetch(
          `/api/v1/empresas/${encodeURIComponent(empresa)}/clientes?${parametros}`,
          { signal: controle.signal },
        );
        if (resposta.status === 401) {
          window.location.assign('/entrar');
          return;
        }
        if (!resposta.ok) throw new Error(`HTTP ${resposta.status}`);
        const resultado = EsquemaPaginaClientes.parse(await resposta.json());
        despachar({
          tipo: 'pagina_carregada',
          requisicao,
          itens: resultado.itens,
          total: resultado.total ?? resultado.itens.length,
        });
      } catch {
        if (!controle.signal.aborted) despachar({ tipo: 'falhou', requisicao });
      }
    })();
    return () => controle.abort();
  }, [estado.requisicao, empresa]);

  // Ao trocar de página, traz o começo da lista de volta para a tela se ele tiver saído dela.
  useEffect(() => {
    if (paginaAnterior.current === estado.pagina) return;
    paginaAnterior.current = estado.pagina;
    const alvo = topo.current;
    if (alvo && alvo.getBoundingClientRect().top < 0) alvo.scrollIntoView({ block: 'start' });
  }, [estado.pagina]);

  const itens = itensDaPagina(estado);
  const vazio = estado.status === 'ocioso' && itens.length === 0;

  return (
    <div ref={topo}>
      <div className="campo">
        <label htmlFor="busca-clientes">Buscar cliente</label>
        <input
          id="busca-clientes"
          type="text"
          value={termo}
          onChange={(evento) => setTermo(evento.target.value)}
          placeholder="Nome, razão social ou CNPJ"
          autoComplete="off"
        />
      </div>

      <ul className="lista">
        {itens.map((cliente) => (
          <li key={cliente.id}>
            <Link href={`/${empresa}/artes/clientes/${cliente.id}`}>
              <strong>{cliente.nomeExibicao}</strong>
              {cliente.nomeFantasia && <span className="hint">{cliente.razaoSocial}</span>}
            </Link>
          </li>
        ))}
      </ul>

      {estado.status === 'carregando' && (
        <div className="hint" role="status">
          Carregando…
        </div>
      )}
      {vazio && (
        <div className="hint">
          {estado.busca
            ? `Nenhum cliente encontrado para '${estado.busca}'.`
            : 'Nenhum cliente cadastrado.'}
        </div>
      )}
      {estado.status === 'erro' && (
        <div className="aviso" role="alert">
          Não foi possível carregar os clientes.{' '}
          <button type="button" onClick={() => despachar({ tipo: 'tentar_de_novo' })}>
            Tentar de novo
          </button>
        </div>
      )}
      {estado.total !== null && (
        <Paginacao
          paginaAtual={estado.pagina}
          totalPaginas={totalDePaginas(estado.total, estado.porPagina)}
          total={estado.total}
          rotulo="clientes"
          aoEscolher={(pagina) => despachar({ tipo: 'pagina_escolhida', pagina })}
        />
      )}
    </div>
  );
}
