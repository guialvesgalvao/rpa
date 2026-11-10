'use client';

import {
  EsquemaErro,
  EsquemaOpcao,
  NOME_COR_MAX,
  chaveDaCor,
  validarNovaCor,
  type Opcao,
} from '@plataforma/contratos';
import { useState } from 'react';

type Props = {
  cores: readonly Opcao[];
  // Cor escolhida: a recém-criada, ou a existente com o mesmo nome (sem maiúsculas nem acentos).
  escolher: (cor: Opcao, nova: boolean) => void;
};

// "Nova cor" no grupo de cores do cadastro da arte: cria pela API (só o nome) e já seleciona.
export function NovaCor({ cores, escolher }: Props) {
  const [aberto, setAberto] = useState(false);
  const [nome, setNome] = useState('');
  const [erro, setErro] = useState('');
  const [enviando, setEnviando] = useState(false);

  function fechar() {
    setAberto(false);
    setNome('');
    setErro('');
  }

  async function adicionar() {
    const invalido = validarNovaCor(nome);
    if (invalido) {
      setErro(invalido);
      return;
    }
    const existente = cores.find((cor) => chaveDaCor(cor.nome) === chaveDaCor(nome));
    if (existente) {
      escolher(existente, false);
      fechar();
      return;
    }
    setErro('');
    setEnviando(true);
    try {
      const resposta = await fetch('/api/v1/cores', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ nome: nome.trim() }),
      });
      if (resposta.status === 401) {
        window.location.assign('/entrar');
        return;
      }
      const corpo: unknown = await resposta.json().catch(() => null);
      if (resposta.ok) {
        escolher(EsquemaOpcao.parse(corpo), true);
        fechar();
        return;
      }
      const falha = EsquemaErro.safeParse(corpo);
      setErro(falha.success ? falha.data.erro.mensagem : 'Não foi possível criar a cor.');
    } catch {
      setErro('Sem conexão com o servidor. Tente novamente.');
    } finally {
      setEnviando(false);
    }
  }

  if (!aberto) {
    return (
      <button type="button" className="nova-cor-abrir" onClick={() => setAberto(true)}>
        + Nova cor
      </button>
    );
  }

  return (
    <div className="nova-cor">
      <div className="nova-cor-linha">
        <input
          type="text"
          aria-label="Nome da nova cor"
          value={nome}
          maxLength={NOME_COR_MAX}
          onChange={(e) => setNome(e.target.value)}
          onKeyDown={(e) => {
            // Enter cria a cor em vez de enviar o formulário da arte.
            if (e.key === 'Enter') {
              e.preventDefault();
              void adicionar();
            }
          }}
          aria-invalid={Boolean(erro)}
          autoFocus
        />
        <button type="button" onClick={() => void adicionar()} disabled={enviando}>
          {enviando ? 'Adicionando…' : 'Adicionar'}
        </button>
        <button type="button" onClick={fechar} disabled={enviando}>
          Cancelar
        </button>
      </div>
      {erro && (
        <div className="erro-campo" role="alert">
          {erro}
        </div>
      )}
    </div>
  );
}
