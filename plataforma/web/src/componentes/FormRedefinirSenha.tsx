'use client';

import { EsquemaErro, EsquemaRedefinicaoSenha, SENHA_MINIMA } from '@plataforma/contratos';
import { useState, type FormEvent } from 'react';

import { CampoSenha } from './CampoSenha';

type Campo = 'novaSenha' | 'confirmacao' | 'geral';

function Erro({ texto }: { texto?: string | undefined }) {
  return texto ? (
    <div className="erro-campo" role="alert">
      {texto}
    </div>
  ) : null;
}

// Senha temporária definida por quem edita usuários (ADR 0013): o usuário troca no próximo acesso.
export function FormRedefinirSenha({ empresa, usuarioId }: { empresa: string; usuarioId: string }) {
  const [novaSenha, setNovaSenha] = useState('');
  const [confirmacao, setConfirmacao] = useState('');
  const [erros, setErros] = useState<Partial<Record<Campo, string>>>({});
  const [sucesso, setSucesso] = useState('');
  const [ocupado, setOcupado] = useState(false);

  async function enviar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    setSucesso('');
    const validacao = EsquemaRedefinicaoSenha.safeParse({ novaSenha });
    if (!validacao.success) {
      setErros({ novaSenha: validacao.error.issues[0]?.message ?? 'Senha inválida.' });
      return;
    }
    if (confirmacao !== novaSenha) {
      setErros({ confirmacao: 'A confirmação não confere com a nova senha.' });
      return;
    }
    setErros({});
    setOcupado(true);
    try {
      const resposta = await fetch(
        `/api/v1/empresas/${encodeURIComponent(empresa)}/usuarios/${usuarioId}/senha`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(validacao.data),
        },
      );
      if (resposta.status === 401) {
        window.location.assign('/entrar');
        return;
      }
      if (!resposta.ok) {
        const falha = EsquemaErro.safeParse(await resposta.json().catch(() => null));
        setErros({
          geral: falha.success ? falha.data.erro.mensagem : 'Não foi possível redefinir a senha.',
        });
        return;
      }
      setSucesso('Senha redefinida. O usuário vai trocá-la no próximo acesso.');
      setNovaSenha('');
      setConfirmacao('');
    } catch {
      setErros({ geral: 'Sem conexão com o servidor. Tente novamente.' });
    } finally {
      setOcupado(false);
    }
  }

  return (
    <form onSubmit={enviar} className="formulario" noValidate>
      {sucesso && (
        <p className="sucesso" role="status">
          {sucesso}
        </p>
      )}
      <div className="campo">
        <label htmlFor="redefinir-nova">Nova senha</label>
        <CampoSenha
          id="redefinir-nova"
          autoComplete="new-password"
          value={novaSenha}
          onChange={(e) => setNovaSenha(e.target.value)}
          aria-invalid={Boolean(erros.novaSenha)}
          disabled={ocupado}
        />
        <div className="hint">
          Ao menos {SENHA_MINIMA} caracteres. O usuário será obrigado a trocar a senha no próximo
          acesso.
        </div>
        <Erro texto={erros.novaSenha} />
      </div>
      <div className="campo">
        <label htmlFor="redefinir-confirmacao">Confirmar nova senha</label>
        <CampoSenha
          id="redefinir-confirmacao"
          autoComplete="new-password"
          value={confirmacao}
          onChange={(e) => setConfirmacao(e.target.value)}
          aria-invalid={Boolean(erros.confirmacao)}
          disabled={ocupado}
        />
        <Erro texto={erros.confirmacao} />
      </div>
      <Erro texto={erros.geral} />
      <div className="actions">
        <button type="submit" className="primary" disabled={ocupado}>
          Redefinir senha
        </button>
      </div>
    </form>
  );
}
