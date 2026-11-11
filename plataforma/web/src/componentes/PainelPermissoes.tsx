'use client';

import { EsquemaErro, type Permissao, normalizarPermissoes } from '@plataforma/contratos';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

import { CamposPermissoes } from './CamposPermissoes';

// Permissões do usuário em uma empresa: marca, salva e a API aplica na hora (ADR 0011).
export function PainelPermissoes({
  empresa,
  nomeEmpresa,
  usuarioId,
  iniciais,
}: {
  empresa: string;
  nomeEmpresa: string;
  usuarioId: string;
  iniciais: readonly string[];
}) {
  const roteador = useRouter();
  const [permissoes, setPermissoes] = useState<Permissao[]>(normalizarPermissoes(iniciais));
  const [erro, setErro] = useState('');
  const [sucesso, setSucesso] = useState('');
  const [ocupado, setOcupado] = useState(false);

  async function salvar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    setErro('');
    setSucesso('');
    setOcupado(true);
    try {
      const resposta = await fetch(
        `/api/v1/empresas/${encodeURIComponent(empresa)}/usuarios/${usuarioId}/permissoes`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ permissoes }),
        },
      );
      if (resposta.status === 401) {
        window.location.assign('/entrar');
        return;
      }
      if (!resposta.ok) {
        const falha = EsquemaErro.safeParse(await resposta.json().catch(() => null));
        setErro(
          falha.success ? falha.data.erro.mensagem : 'Não foi possível salvar as permissões.',
        );
        return;
      }
      setSucesso(`Permissões em ${nomeEmpresa} salvas.`);
      roteador.refresh();
    } catch {
      setErro('Sem conexão com o servidor. Tente novamente.');
    } finally {
      setOcupado(false);
    }
  }

  return (
    <form onSubmit={salvar} className="formulario" noValidate>
      {sucesso && (
        <p className="sucesso" role="status">
          {sucesso}
        </p>
      )}
      <CamposPermissoes
        empresa={empresa}
        nomeEmpresa={nomeEmpresa}
        valor={permissoes}
        aoMudar={setPermissoes}
        desabilitado={ocupado}
      />
      {erro && (
        <div className="erro-campo" role="alert">
          {erro}
        </div>
      )}
      <div className="actions">
        <button type="submit" className="primary" disabled={ocupado}>
          Salvar permissões em {nomeEmpresa}
        </button>
      </div>
    </form>
  );
}
