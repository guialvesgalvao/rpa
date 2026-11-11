'use client';

import {
  AREAS,
  type Area,
  EsquemaCriacaoUsuario,
  EsquemaEdicaoUsuario,
  EsquemaErro,
  type Permissao,
  ROTULOS_AREA,
  SENHA_MINIMA,
  type UsuarioDetalhe,
} from '@plataforma/contratos';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

import type { Empresa } from '../empresas';
import { CamposPermissoes } from './CamposPermissoes';

type Campo = 'nome' | 'email' | 'area' | 'empresas' | 'senha' | 'geral';
type Erros = Partial<Record<Campo, string>>;
type OpcaoEmpresa = Pick<Empresa, 'slug' | 'nome'>;

function Erro({ texto }: { texto?: string }) {
  return texto ? (
    <div className="erro-campo" role="alert">
      {texto}
    </div>
  ) : null;
}

// Recusa da API no campo certo: e-mail repetido no e-mail, empresa alheia nas empresas; o resto, embaixo.
async function errosDaApi(resposta: Response, padrao: string): Promise<Erros> {
  const falha = EsquemaErro.safeParse(await resposta.json().catch(() => null));
  const mensagem = falha.success ? falha.data.erro.mensagem : padrao;
  const codigo = falha.success ? falha.data.erro.codigo : '';
  if (codigo === 'email_em_uso') return { email: mensagem };
  if (codigo === 'empresa_proibida' || codigo === 'ultimo_administrador') {
    return { empresas: mensagem };
  }
  return { geral: mensagem };
}

type Props = {
  // Empresa da página: a rota da API é a dela.
  empresa: string;
  // Empresas que quem edita pode dar ao usuário (as em que pode editar usuários).
  empresas: OpcaoEmpresa[];
  // Empresas em que quem edita pode marcar permissões na criação.
  empresasComPermissoes: string[];
  // Ausente: criação (com senha inicial e permissões). Presente: edição dos dados.
  usuario?: UsuarioDetalhe;
};

// Criação (nome, e-mail, área, empresas, senha inicial e permissões) ou edição dos dados do usuário. Na edição,
// as permissões ficam no painel próprio, por empresa.
export function FormUsuario({ empresa, empresas, empresasComPermissoes, usuario }: Props) {
  const roteador = useRouter();
  const edicao = Boolean(usuario);
  const fixa = !edicao && empresas.length === 1;
  const [nome, setNome] = useState(usuario?.nome ?? '');
  const [email, setEmail] = useState(usuario?.email ?? '');
  const [area, setArea] = useState<Area | ''>(usuario?.area ?? '');
  const [escolhidas, setEscolhidas] = useState<string[]>(
    usuario ? usuario.empresas.map((e) => e.slug) : fixa ? empresas.map((e) => e.slug) : [],
  );
  const [senha, setSenha] = useState('');
  const [permissoes, setPermissoes] = useState<Record<string, Permissao[]>>({});
  const [erros, setErros] = useState<Erros>({});
  const [sucesso, setSucesso] = useState('');
  const [ocupado, setOcupado] = useState(false);

  function alternarEmpresa(slug: string) {
    setEscolhidas((atual) =>
      atual.includes(slug) ? atual.filter((s) => s !== slug) : [...atual, slug],
    );
  }

  async function enviar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    setSucesso('');
    // A área é obrigatória no formulário (usuários antigos podem estar sem; a API aceita vazio).
    if (!area) {
      setErros({ area: 'Escolha a área.' });
      return;
    }
    const dados = { nome, email, area, empresas: escolhidas };
    const validacao = edicao
      ? EsquemaEdicaoUsuario.safeParse(dados)
      : EsquemaCriacaoUsuario.safeParse({
          ...dados,
          senha,
          permissoes: Object.fromEntries(
            escolhidas
              .filter((slug) => empresasComPermissoes.includes(slug))
              .map((slug) => [slug, permissoes[slug] ?? []]),
          ),
        });
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
    const base = `/api/v1/empresas/${encodeURIComponent(empresa)}/usuarios`;
    try {
      const resposta = await fetch(usuario ? `${base}/${usuario.id}` : base, {
        method: usuario ? 'PATCH' : 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(validacao.data),
      });
      if (resposta.status === 401) {
        window.location.assign('/entrar');
        return;
      }
      if (!resposta.ok) {
        setErros(
          await errosDaApi(
            resposta,
            edicao ? 'Não foi possível salvar o usuário.' : 'Não foi possível criar o usuário.',
          ),
        );
        return;
      }
      if (edicao) {
        setSucesso('Dados salvos.');
      } else {
        setSucesso(
          `Usuário ${dados.email.trim().toLowerCase()} criado. Ele troca a senha no primeiro login.`,
        );
        setNome('');
        setEmail('');
        setArea('');
        setSenha('');
        setPermissoes({});
        if (!fixa) setEscolhidas([]);
      }
      roteador.refresh();
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
        <label htmlFor="usuario-area">Área</label>
        <select
          id="usuario-area"
          value={area}
          onChange={(e) => setArea(e.target.value as Area | '')}
          aria-invalid={Boolean(erros.area)}
        >
          <option value="">Selecione…</option>
          {AREAS.map((a) => (
            <option key={a} value={a}>
              {ROTULOS_AREA[a]}
            </option>
          ))}
        </select>
        <Erro texto={erros.area} />
      </div>

      <fieldset className="campo">
        <legend>Empresas</legend>
        {empresas.map((opcao) => (
          <label key={opcao.slug} className="opcao">
            <input
              type="checkbox"
              checked={escolhidas.includes(opcao.slug)}
              disabled={fixa}
              onChange={() => alternarEmpresa(opcao.slug)}
            />
            {opcao.nome}
          </label>
        ))}
        <Erro texto={erros.empresas} />
      </fieldset>

      {!edicao && (
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
      )}

      {!edicao &&
        empresas
          .filter((e) => escolhidas.includes(e.slug) && empresasComPermissoes.includes(e.slug))
          .map((e) => (
            <CamposPermissoes
              key={e.slug}
              empresa={e.slug}
              nomeEmpresa={e.nome}
              valor={permissoes[e.slug] ?? []}
              aoMudar={(novas) => setPermissoes((atual) => ({ ...atual, [e.slug]: novas }))}
            />
          ))}

      <Erro texto={erros.geral} />
      <div className="actions">
        <button type="submit" className="primary" disabled={ocupado}>
          {edicao ? 'Salvar dados' : 'Criar usuário'}
        </button>
      </div>
    </form>
  );
}
