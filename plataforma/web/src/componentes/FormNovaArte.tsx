'use client';

import {
  EsquemaErro,
  LIMITES,
  NOME_PADRAO_ARTE,
  detectarTipo,
  validarNovaArte,
  type CampoNovaArte,
  type EntradaArquivo,
  type ErrosNovaArte,
  type Opcao,
} from '@plataforma/contratos';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

type Props = {
  empresa: string;
  clienteId: string;
  produtos: Opcao[];
  cores: Opcao[];
  maquinas: Opcao[];
};

type Selecionado = { arquivo: File; entrada: NonNullable<EntradaArquivo> };

const MB = 1024 * 1024;

// O tipo vem dos primeiros bytes (como na API), não da extensão.
async function selecionar(arquivo: File | undefined): Promise<Selecionado | null> {
  if (!arquivo) return null;
  const inicio = new Uint8Array(await arquivo.slice(0, 16).arrayBuffer());
  return { arquivo, entrada: { tamanho: arquivo.size, tipo: detectarTipo(inicio)?.tipo ?? null } };
}

function Erro({ texto }: { texto?: string }) {
  return texto ? (
    <div className="erro-campo" role="alert">
      {texto}
    </div>
  ) : null;
}

export function FormNovaArte({ empresa, clienteId, produtos, cores, maquinas }: Props) {
  const roteador = useRouter();
  const [produtoId, setProdutoId] = useState('');
  const [nome, setNome] = useState('');
  const [corId, setCorId] = useState('');
  const [maquinaIds, setMaquinaIds] = useState<string[]>([]);
  const [pdf, setPdf] = useState<Selecionado | null>(null);
  const [imagem, setImagem] = useState<Selecionado | null>(null);
  const [erros, setErros] = useState<ErrosNovaArte>({});
  const [erroGeral, setErroGeral] = useState('');
  const [enviando, setEnviando] = useState(false);

  const alternarMaquina = (id: string) =>
    setMaquinaIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));

  async function enviar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    setErroGeral('');
    const errosLocais = validarNovaArte({
      produtoId,
      nome,
      corId,
      maquinaIds,
      pdf: pdf?.entrada,
      imagem: imagem?.entrada,
    });
    setErros(errosLocais);
    if (Object.keys(errosLocais).length > 0) return;

    const corpo = new FormData();
    corpo.set('produtoId', produtoId);
    corpo.set('nome', nome);
    corpo.set('corId', corId);
    for (const id of maquinaIds) corpo.append('maquinaIds', id);
    if (pdf) corpo.set('pdf', pdf.arquivo);
    if (imagem) corpo.set('imagem', imagem.arquivo);

    setEnviando(true);
    try {
      const resposta = await fetch(
        `/api/v1/empresas/${encodeURIComponent(empresa)}/clientes/${clienteId}/artes`,
        { method: 'POST', body: corpo },
      );
      if (resposta.status === 401) {
        window.location.assign('/entrar');
        return;
      }
      if (resposta.ok) {
        roteador.push(`/${empresa}/artes/clientes/${clienteId}?cadastrada=1`);
        return;
      }
      const falha = EsquemaErro.safeParse(await resposta.json().catch(() => null));
      const mensagem = falha.success
        ? falha.data.erro.mensagem
        : 'Não foi possível cadastrar a arte. Tente novamente.';
      const campo: CampoNovaArte | null =
        resposta.status === 409 ? 'nome' : [413, 415].includes(resposta.status) ? 'arquivos' : null;
      if (campo) setErros({ [campo]: mensagem });
      else setErroGeral(mensagem);
    } catch {
      setErroGeral('Sem conexão com o servidor. Tente novamente.');
    } finally {
      setEnviando(false);
    }
  }

  return (
    <form onSubmit={enviar} noValidate className="formulario">
      {erroGeral && (
        <p className="aviso" role="alert">
          {erroGeral}
        </p>
      )}

      <div className="campo">
        <label htmlFor="produto">Produto</label>
        <select
          id="produto"
          value={produtoId}
          onChange={(e) => setProdutoId(e.target.value)}
          aria-invalid={Boolean(erros.produtoId)}
        >
          <option value="">Selecione…</option>
          {produtos.map((produto) => (
            <option key={produto.id} value={produto.id}>
              {produto.nome}
            </option>
          ))}
        </select>
        <Erro texto={erros.produtoId} />
      </div>

      <div className="campo">
        <label htmlFor="nome">Nome</label>
        <input
          id="nome"
          type="text"
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          placeholder={NOME_PADRAO_ARTE}
          aria-invalid={Boolean(erros.nome)}
        />
        <div className="hint">Se ficar em branco, a arte será salva como &apos;Padrão&apos;.</div>
        <Erro texto={erros.nome} />
      </div>

      <fieldset className="campo">
        <legend>Cor</legend>
        {cores.map((cor) => (
          <label key={cor.id} className="opcao">
            <input
              type="radio"
              name="cor"
              value={cor.id}
              checked={corId === cor.id}
              onChange={() => setCorId(cor.id)}
            />
            {cor.nome}
          </label>
        ))}
        <Erro texto={erros.corId} />
      </fieldset>

      <fieldset className="campo">
        <legend>Máquinas suportadas</legend>
        {maquinas.map((maquina) => (
          <label key={maquina.id} className="opcao">
            <input
              type="checkbox"
              checked={maquinaIds.includes(maquina.id)}
              onChange={() => alternarMaquina(maquina.id)}
            />
            {maquina.nome}
          </label>
        ))}
        <div className="hint">Marque uma ou as duas.</div>
        <Erro texto={erros.maquinaIds} />
      </fieldset>

      <div className="campo">
        <label htmlFor="pdf">PDF</label>
        <input
          id="pdf"
          type="file"
          accept="application/pdf,.pdf"
          onChange={async (e) => setPdf(await selecionar(e.target.files?.[0]))}
        />
        <div className="hint">Até {LIMITES.pdfBytes / MB} MB.</div>
      </div>

      <div className="campo">
        <label htmlFor="imagem">Imagem</label>
        <input
          id="imagem"
          type="file"
          accept="image/png,image/jpeg,image/webp"
          onChange={async (e) => setImagem(await selecionar(e.target.files?.[0]))}
        />
        <div className="hint">PNG, JPEG ou WebP, até {LIMITES.imagemBytes / MB} MB.</div>
        <div className="hint">Envie ao menos um arquivo.</div>
        <Erro texto={erros.arquivos} />
      </div>

      <div className="actions">
        <button type="submit" className="primary" disabled={enviando}>
          {enviando ? 'Salvando…' : 'Salvar'}
        </button>
      </div>
    </form>
  );
}
