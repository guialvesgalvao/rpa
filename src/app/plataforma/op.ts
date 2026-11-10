import type { Passo } from '../../core/rastro.js';
import type { InsumoOp } from '../../processes/bling/pedido-op.js';
import type { PedidoLido } from '../../processes/op/pedidos.js';
import { observacaoDoPedido } from '../../processes/op/preenchimento.js';
import { formatarDataOp } from '../../processes/op/template.js';
import { type ClienteArtes, produtoDoCodigo } from './artes.js';
import type { ArteDoProduto, Cliente } from './contratos.js';

const mensagemDoErro = (erro: unknown): string =>
  erro instanceof Error ? erro.message : String(erro);

/** Item do pedido como a tela da OP mostra, com o produto do banco e as artes dele. */
export type ItemOpTela = {
  /** Posição do item no pedido (identifica o item na geração). */
  indice: number;
  descricao: string;
  codigo: string;
  unidade: string;
  quantidade: number;
  insumos?: InsumoOp[];
  /** Ex.: "Produto sem insumos cadastrados": o item aparece, mas não gera OP. */
  erro?: string;
  produtoId: string | null;
  /** Da mais nova para a mais antiga. */
  artes: ArteDoProduto[];
};

export type PedidoOpTela =
  | {
      numero: string;
      situacao: 'ok';
      clienteNome: string;
      clienteFantasia?: string;
      /** dd/mm/aaaa */
      dataVenda: string;
      dataPrevista?: string;
      /** Cliente do banco (por CNPJ); `null` se não achou: o pedido segue sem arte. */
      cliente: Cliente | null;
      /** Por que não há artes (sem CNPJ, cliente não cadastrado, servidor fora). */
      aviso?: string;
      /** Observação do pedido, já no limite da OP: valor inicial da Observação de cada produto. */
      observacao?: string;
      /** A observação do pedido passou do limite e foi cortada. */
      observacaoCortada?: boolean;
      itens: ItemOpTela[];
    }
  | { numero: string; situacao: 'erro'; erro: string; passos: Passo[] };

export const AVISO_SEM_CNPJ = 'Pedido sem CNPJ do cliente: os produtos ficam sem arte.';
export const AVISO_SEM_CLIENTE = 'Cliente não cadastrado na plataforma: os produtos ficam sem arte.';

type ApiOp = Pick<ClienteArtes, 'clientePorCnpj' | 'produtosDoCliente' | 'artesDoProduto'>;

/**
 * Junta os pedidos lidos com o banco da plataforma: cliente pelo CNPJ e, para cada item com insumos,
 * as artes do produto de mesmo código. Falha da API não derruba o pedido: vira aviso e o pedido
 * segue sem arte (a OP não bloqueia por falta de arte).
 */
export async function montarPedidosTela(
  lidos: readonly PedidoLido[],
  empresa: string,
  api: ApiOp,
): Promise<PedidoOpTela[]> {
  const telas: PedidoOpTela[] = [];
  for (const lido of lidos) {
    if ('erro' in lido) {
      telas.push({ numero: lido.numero, situacao: 'erro', erro: lido.erro, passos: lido.passos });
      continue;
    }
    const { pedido } = lido;
    const itens: ItemOpTela[] = pedido.itens.map((item, indice) => ({
      indice,
      descricao: item.descricao,
      codigo: item.codigo,
      unidade: item.unidade,
      quantidade: item.quantidade,
      insumos: item.insumos,
      erro: item.erro,
      produtoId: null,
      artes: [],
    }));
    let cliente: Cliente | null = null;
    let aviso: string | undefined;
    try {
      if (!pedido.cnpj) {
        aviso = AVISO_SEM_CNPJ;
      } else {
        cliente = await api.clientePorCnpj(empresa, pedido.cnpj);
        if (!cliente) aviso = AVISO_SEM_CLIENTE;
      }
      if (cliente && itens.some((i) => !i.erro)) {
        const produtos = await api.produtosDoCliente(empresa, cliente.id);
        for (const item of itens) {
          const produto = item.erro ? undefined : produtoDoCodigo(produtos, item.codigo);
          if (!produto) continue;
          item.produtoId = produto.id;
          item.artes = await api.artesDoProduto(empresa, cliente.id, produto.id);
        }
      }
    } catch (erro) {
      aviso = `Não foi possível buscar as artes: ${mensagemDoErro(erro)}`;
    }
    const observacao = observacaoDoPedido(pedido.observacao);
    telas.push({
      numero: pedido.numero,
      situacao: 'ok',
      clienteNome: pedido.clienteNome,
      clienteFantasia: pedido.clienteFantasia,
      dataVenda: formatarDataOp(pedido.dataVenda),
      dataPrevista: pedido.dataPrevista && formatarDataOp(pedido.dataPrevista),
      cliente,
      aviso,
      ...(observacao && { observacao: observacao.texto }),
      ...(observacao?.cortada && { observacaoCortada: true }),
      itens,
    });
  }
  return telas;
}
