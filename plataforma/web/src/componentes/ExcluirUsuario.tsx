'use client';

import { EsquemaErro } from '@plataforma/contratos';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

// Exclusão com confirmação. O usuário perde o acesso na hora e some da lista; o histórico continua mostrando o
// nome dele e o e-mail não pode ser reutilizado.
export function ExcluirUsuario({
  empresa,
  usuarioId,
  nome,
}: {
  empresa: string;
  usuarioId: string;
  nome: string;
}) {
  const roteador = useRouter();
  const [erro, setErro] = useState('');
  const [ocupado, setOcupado] = useState(false);

  async function excluir() {
    if (!window.confirm(`Excluir o usuário ${nome}? Ele perde o acesso imediatamente.`)) return;
    setErro('');
    setOcupado(true);
    try {
      const resposta = await fetch(
        `/api/v1/empresas/${encodeURIComponent(empresa)}/usuarios/${usuarioId}`,
        { method: 'DELETE' },
      );
      if (resposta.status === 401) {
        window.location.assign('/entrar');
        return;
      }
      if (!resposta.ok) {
        const falha = EsquemaErro.safeParse(await resposta.json().catch(() => null));
        setErro(falha.success ? falha.data.erro.mensagem : 'Não foi possível excluir o usuário.');
        return;
      }
      roteador.push(`/${empresa}/usuarios?excluido=1`);
      roteador.refresh();
    } catch {
      setErro('Sem conexão com o servidor. Tente novamente.');
    } finally {
      setOcupado(false);
    }
  }

  return (
    <>
      <p className="hint">
        O usuário perde o acesso na hora e sai da lista. O histórico continua mostrando o nome dele,
        e o e-mail não pode ser usado em outro cadastro.
      </p>
      {erro && (
        <div className="erro-campo" role="alert">
          {erro}
        </div>
      )}
      <div className="actions">
        <button type="button" disabled={ocupado} onClick={() => void excluir()}>
          Excluir usuário
        </button>
      </div>
    </>
  );
}
