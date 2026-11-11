'use client';

import {
  EsquemaErro,
  EsquemaPedidoCompra,
  type Insumo,
  OBSERVACAO_COMPRA_MAX,
  type PedidoCompra,
  rotuloInsumo,
} from '@plataforma/contratos';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

import { filtrarInsumos, lerQuantidade, quantidadeParaCampo } from '../compras';

type Campo = 'insumo' | 'quantidade' | 'geral';
type Erros = Partial<Record<Campo, string>>;

function Erro({ texto }: { texto?: string }) {
  return texto ? (
    <div className="erro-campo" role="alert">
      {texto}
    </div>
  ) : null;
}

async function errosDaApi(resposta: Response, padrao: string): Promise<Erros> {
  const falha = EsquemaErro.safeParse(await resposta.json().catch(() => null));
  const mensagem = falha.success ? falha.data.erro.mensagem : padrao;
  return falha.success && falha.data.erro.codigo === 'insumo_invalido'
    ? { insumo: mensagem }
    : { geral: mensagem };
}

type Props = {
  empresa: string;
  // Insumos que podem ser escolhidos (TPP ativos). Vazio na edição de quem não pode pedir: o insumo fica.
  insumos: Insumo[];
  // Ausente: novo pedido. Presente: edição.
  pedido?: Pick<PedidoCompra, 'id' | 'insumo' | 'quantidade' | 'observacao'>;
  // Na edição: depois de salvar (fecha o formulário).
  aoSalvar?: () => void;
};

// Novo pedido (insumo da lista TPP, quantidade e observação) ou edição dos mesmos campos.
export function FormPedido({ empresa, insumos, pedido, aoSalvar }: Props) {
  const roteador = useRouter();
  const [busca, setBusca] = useState('');
  const [insumoId, setInsumoId] = useState(pedido?.insumo.id ?? '');
  const [quantidade, setQuantidade] = useState(
    pedido ? quantidadeParaCampo(pedido.quantidade) : '',
  );
  const [observacao, setObservacao] = useState(pedido?.observacao ?? '');
  const [erros, setErros] = useState<Erros>({});
  const [ocupado, setOcupado] = useState(false);

  const escolheInsumo = insumos.length > 0;
  // O insumo atual do pedido continua na lista mesmo se deixou de ser TPP ativo.
  const opcoes =
    pedido && escolheInsumo && !insumos.some((i) => i.id === pedido.insumo.id)
      ? [pedido.insumo, ...insumos]
      : insumos;
  const filtrados = filtrarInsumos(opcoes, busca);

  function buscar(termo: string) {
    setBusca(termo);
    const encontrados = filtrarInsumos(opcoes, termo);
    if (!encontrados.some((i) => i.id === insumoId)) setInsumoId(encontrados[0]?.id ?? '');
  }

  async function enviar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    const novos: Erros = {};
    if (escolheInsumo && !insumoId) novos.insumo = 'Escolha o insumo.';
    const valor = lerQuantidade(quantidade);
    if (valor === undefined) {
      novos.quantidade = 'Informe uma quantidade maior que zero, com até 3 casas decimais.';
    }
    setErros(novos);
    if (Object.keys(novos).length > 0 || valor === undefined) return;

    const corpo = {
      ...(escolheInsumo && { insumoId }),
      quantidade: valor,
      observacao: observacao.trim() || null,
    };
    const base = `/api/v1/empresas/${encodeURIComponent(empresa)}/compras/pedidos`;
    setOcupado(true);
    try {
      const resposta = await fetch(pedido ? `${base}/${pedido.id}` : base, {
        method: pedido ? 'PATCH' : 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(corpo),
      });
      if (resposta.status === 401) {
        window.location.assign('/entrar');
        return;
      }
      if (!resposta.ok) {
        setErros(
          await errosDaApi(
            resposta,
            pedido ? 'Não foi possível salvar o pedido.' : 'Não foi possível criar o pedido.',
          ),
        );
        return;
      }
      if (pedido) {
        aoSalvar?.();
        roteador.refresh();
        return;
      }
      const criado = EsquemaPedidoCompra.parse(await resposta.json());
      roteador.push(`/${empresa}/compras/${criado.id}?criado`);
    } catch {
      setErros({ geral: 'Sem conexão com o servidor. Tente novamente.' });
    } finally {
      setOcupado(false);
    }
  }

  return (
    <form onSubmit={enviar} className="formulario" noValidate>
      {escolheInsumo ? (
        <div className="campo">
          <label htmlFor="pedido-busca">Buscar insumo</label>
          <input
            id="pedido-busca"
            type="search"
            placeholder="Código ou nome"
            value={busca}
            onChange={(e) => buscar(e.target.value)}
          />
          <label htmlFor="pedido-insumo" className="rotulo-secundario">
            Insumo
          </label>
          <select
            id="pedido-insumo"
            value={insumoId}
            onChange={(e) => setInsumoId(e.target.value)}
            aria-invalid={Boolean(erros.insumo)}
          >
            <option value="">{filtrados.length ? 'Selecione…' : 'Nenhum insumo encontrado'}</option>
            {filtrados.map((insumo) => (
              <option key={insumo.id} value={insumo.id}>
                {rotuloInsumo(insumo)}
              </option>
            ))}
          </select>
          <Erro texto={erros.insumo} />
        </div>
      ) : (
        pedido && (
          <div className="campo">
            <span className="rotulo-secundario">Insumo</span>
            <span>{rotuloInsumo(pedido.insumo)}</span>
          </div>
        )
      )}

      <div className="campo">
        <label htmlFor="pedido-quantidade">Quantidade</label>
        <input
          id="pedido-quantidade"
          type="text"
          inputMode="decimal"
          autoComplete="off"
          value={quantidade}
          onChange={(e) => setQuantidade(e.target.value)}
          aria-invalid={Boolean(erros.quantidade)}
        />
        <Erro texto={erros.quantidade} />
      </div>

      <div className="campo">
        <label htmlFor="pedido-observacao">Observação (opcional)</label>
        <textarea
          id="pedido-observacao"
          rows={3}
          maxLength={OBSERVACAO_COMPRA_MAX}
          value={observacao}
          onChange={(e) => setObservacao(e.target.value)}
        />
      </div>

      <Erro texto={erros.geral} />
      <div className="actions">
        <button type="submit" className="primary" disabled={ocupado}>
          {pedido ? 'Salvar alterações' : 'Criar pedido'}
        </button>
      </div>
    </form>
  );
}
