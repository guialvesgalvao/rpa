'use client';

import {
  EsquemaErro,
  EsquemaNovoUsuario,
  type Perfil,
  ROTULOS_PERFIL,
  SENHA_MINIMA,
} from '@plataforma/contratos';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

import type { Empresa } from '../empresas';

type Campo = 'nome' | 'email' | 'perfil' | 'empresas' | 'senha' | 'geral';
type Erros = Partial<Record<Campo, string>>;

const PERFIS: Perfil[] = ['arte_finalista', 'admin'];

function Erro({ texto }: { texto?: string }) {
  return texto ? (
    <div className="erro-campo" role="alert">
      {texto}
    </div>
  ) : null;
}

// Recusa da API no campo certo: e-mail repetido no e-mail, empresa alheia nas empresas; o resto, embaixo.
async function errosDaApi(resposta: Response): Promise<Erros> {
  const falha = EsquemaErro.safeParse(await resposta.json().catch(() => null));
  const mensagem = falha.success ? falha.data.erro.mensagem : 'Não foi possível criar o usuário.';
  const codigo = falha.success ? falha.data.erro.codigo : '';
  if (codigo === 'email_em_uso') return { email: mensagem };
  if (codigo === 'empresa_proibida') return { empresas: mensagem };
  return { geral: mensagem };
}

// Cria um usuário nas empresas do admin com a senha inicial; o usuário troca a senha no primeiro login.
export function FormNovoUsuario({
  empresas,
  empresaFixa,
}: {
  empresas: Empresa[];
  empresaFixa: boolean;
}) {
  const roteador = useRouter();
  const [nome, setNome] = useState('');
  const [email, setEmail] = useState('');
  const [perfil, setPerfil] = useState<Perfil>('arte_finalista');
  const [escolhidas, setEscolhidas] = useState<string[]>(
    empresaFixa ? empresas.map((e) => e.slug) : [],
  );
  const [senha, setSenha] = useState('');
  const [erros, setErros] = useState<Erros>({});
  const [sucesso, setSucesso] = useState('');
  const [ocupado, setOcupado] = useState(false);

  function alternarEmpresa(slug: string) {
    setEscolhidas((atual) =>
      atual.includes(slug) ? atual.filter((s) => s !== slug) : [...atual, slug],
    );
  }

  async function criar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    setSucesso('');
    const corpo = { nome, email, perfil, empresas: escolhidas, senha };
    const validacao = EsquemaNovoUsuario.safeParse(corpo);
    if (!validacao.success) {
      const novos: Erros = {};
      for (const issue of validacao.error.issues) {
        const campo = issue.path[0] as Campo | undefined;
        if (campo && !novos[campo]) novos[campo] = issue.message;
      }
      setErros(novos);
      return;
    }
    setErros({});
    setOcupado(true);
    try {
      const resposta = await fetch('/api/v1/usuarios', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(validacao.data),
      });
      if (resposta.status === 401) {
        window.location.assign('/entrar');
        return;
      }
      if (!resposta.ok) {
        setErros(await errosDaApi(resposta));
        return;
      }
      setSucesso(`Usuário ${validacao.data.email} criado. Ele troca a senha no primeiro login.`);
      setNome('');
      setEmail('');
      setSenha('');
      setPerfil('arte_finalista');
      if (!empresaFixa) setEscolhidas([]);
      roteador.refresh();
    } catch {
      setErros({ geral: 'Sem conexão com o servidor. Tente novamente.' });
    } finally {
      setOcupado(false);
    }
  }

  return (
    <form onSubmit={criar} className="formulario" noValidate>
      {sucesso && (
        <p className="sucesso" role="status">
          {sucesso}
        </p>
      )}
      <div className="campo">
        <label htmlFor="usuario-nome">Nome</label>
        <input
          id="usuario-nome"
          type="text"
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          aria-invalid={Boolean(erros.nome)}
        />
        <Erro texto={erros.nome} />
      </div>

      <div className="campo">
        <label htmlFor="usuario-email">E-mail</label>
        <input
          id="usuario-email"
          type="email"
          autoComplete="off"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          aria-invalid={Boolean(erros.email)}
        />
        <Erro texto={erros.email} />
      </div>

      <div className="campo">
        <label htmlFor="usuario-perfil">Perfil</label>
        <select
          id="usuario-perfil"
          value={perfil}
          onChange={(e) => setPerfil(e.target.value as Perfil)}
        >
          {PERFIS.map((p) => (
            <option key={p} value={p}>
              {ROTULOS_PERFIL[p]}
            </option>
          ))}
        </select>
        <Erro texto={erros.perfil} />
      </div>

      <fieldset className="campo">
        <legend>Empresas</legend>
        {empresas.map((empresa) => (
          <label key={empresa.slug} className="opcao">
            <input
              type="checkbox"
              checked={escolhidas.includes(empresa.slug)}
              disabled={empresaFixa}
              onChange={() => alternarEmpresa(empresa.slug)}
            />
            {empresa.nome}
          </label>
        ))}
        <Erro texto={erros.empresas} />
      </fieldset>

      <div className="campo">
        <label htmlFor="usuario-senha">Senha inicial</label>
        <input
          id="usuario-senha"
          type="password"
          autoComplete="new-password"
          value={senha}
          onChange={(e) => setSenha(e.target.value)}
          aria-invalid={Boolean(erros.senha)}
        />
        <div className="hint">
          Ao menos {SENHA_MINIMA} caracteres. Passe a senha ao usuário por um canal seguro; ele
          troca no primeiro login.
        </div>
        <Erro texto={erros.senha} />
      </div>

      <Erro texto={erros.geral} />
      <div className="actions">
        <button type="submit" className="primary" disabled={ocupado}>
          Criar usuário
        </button>
      </div>
    </form>
  );
}
