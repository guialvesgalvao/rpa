'use client';

import {
  EsquemaPaginaClientes,
  LIMITE_PADRAO_CLIENTES,
  estadoInicial,
  redutorLista,
  type Cliente,
} from '@plataforma/contratos';
import Link from 'next/link';
import { useEffect, useReducer, useRef, useState } from 'react';

const ESPERA_BUSCA_MS = 300;

// Clientes da empresa com busca (300 ms de espera) e scroll infinito. Uma busca nova cancela a anterior.
export function ListaClientes({ empresa }: { empresa: string }) {
  const [estado, despachar] = useReducer(redutorLista<Cliente>, undefined, () =>
    estadoInicial<Cliente>(),
  );
  const [termo, setTermo] = useState('');
  const sentinela = useRef<HTMLDivElement>(null);
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
    const { requisicao, busca, proximoCursor, status } = atual.current;
    if (status !== 'carregando') return;
    const controle = new AbortController();

    const parametros = new URLSearchParams({ limite: String(LIMITE_PADRAO_CLIENTES) });
    if (busca) parametros.set('busca', busca);
    if (proximoCursor) parametros.set('cursor', proximoCursor);

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
        const pagina = EsquemaPaginaClientes.parse(await resposta.json());
        despachar({
          tipo: 'pagina_carregada',
          requisicao,
          itens: pagina.itens,
          proximoCursor: pagina.proximoCursor,
        });
      } catch {
        if (!controle.signal.aborted) despachar({ tipo: 'falhou', requisicao });
      }
    })();
    return () => controle.abort();
  }, [estado.requisicao, empresa]);

  // Pede a próxima página quando o fim da lista aparece na tela.
  useEffect(() => {
    const alvo = sentinela.current;
    if (!alvo || estado.status !== 'ocioso' || estado.fim) return;
    const observador = new IntersectionObserver((entradas) => {
      if (entradas.some((entrada) => entrada.isIntersecting)) despachar({ tipo: 'carregar_mais' });
    });
    observador.observe(alvo);
    return () => observador.disconnect();
  }, [estado.status, estado.fim, estado.requisicao]);

  const vazio = estado.status === 'ocioso' && estado.itens.length === 0;

  return (
    <div>
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
        {estado.itens.map((cliente) => (
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
      <div ref={sentinela} aria-hidden="true" />
    </div>
  );
}
