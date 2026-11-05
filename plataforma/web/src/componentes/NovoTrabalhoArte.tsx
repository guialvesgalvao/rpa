'use client';

import { EsquemaErro, EsquemaTarefa, type Opcao } from '@plataforma/contratos';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

type Props = { empresa: string; clienteId: string; catalogo: Opcao[] };

// Um produto do catálogo da empresa e as duas saídas: inserir uma arte pronta (formulário de nova arte com o
// produto escolhido) ou iniciar o desenvolvimento (cria a tarefa e abre a página dela).
export function NovoTrabalhoArte({ empresa, clienteId, catalogo }: Props) {
  const roteador = useRouter();
  const [produtoId, setProdutoId] = useState('');
  const [erro, setErro] = useState('');
  const [enviando, setEnviando] = useState(false);

  const escolhido = (): string | null => {
    setErro(produtoId ? '' : 'Selecione um produto do catálogo.');
    return produtoId || null;
  };

  function inserirPronta() {
    const produto = escolhido();
    if (produto) roteador.push(`/${empresa}/artes/nova?cliente=${clienteId}&produto=${produto}`);
  }

  async function iniciar() {
    const produto = escolhido();
    if (!produto) return;
    setEnviando(true);
    try {
      const resposta = await fetch(
        `/api/v1/empresas/${encodeURIComponent(empresa)}/clientes/${clienteId}/produtos/${produto}/tarefas`,
        { method: 'POST' },
      );
      if (resposta.status === 401) {
        window.location.assign('/entrar');
        return;
      }
      const corpo: unknown = await resposta.json().catch(() => null);
      const tarefa = EsquemaTarefa.safeParse(corpo);
      if (resposta.ok && tarefa.success) {
        roteador.push(`/${empresa}/artes/tarefas/${tarefa.data.id}?criada=1`);
        return;
      }
      const falha = EsquemaErro.safeParse(corpo);
      setErro(falha.success ? falha.data.erro.mensagem : 'Não foi possível criar a tarefa.');
    } catch {
      setErro('Sem conexão com o servidor. Tente novamente.');
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="formulario">
      <div className="campo">
        <label htmlFor="produto-trabalho">Produto do catálogo</label>
        <select
          id="produto-trabalho"
          value={produtoId}
          onChange={(e) => setProdutoId(e.target.value)}
          aria-invalid={Boolean(erro)}
        >
          <option value="">Selecione…</option>
          {catalogo.map((produto) => (
            <option key={produto.id} value={produto.id}>
              {produto.nome}
            </option>
          ))}
        </select>
        <div className="hint">
          Insira uma arte que já existe ou inicie o desenvolvimento: a tarefa registra o andamento
          até a arte ficar pronta.
        </div>
        {erro && (
          <div className="erro-campo" role="alert">
            {erro}
          </div>
        )}
      </div>
      <div className="actions">
        <button type="button" onClick={inserirPronta}>
          Inserir arte pronta
        </button>
        <button type="button" className="primary" onClick={iniciar} disabled={enviando}>
          {enviando ? 'Criando…' : 'Iniciar desenvolvimento'}
        </button>
      </div>
    </div>
  );
}
