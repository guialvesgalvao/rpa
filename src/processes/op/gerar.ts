import { criarRastro, primeiraLinha, type Passo } from '../../core/rastro.js';
import type { ItemOp, PedidoOp } from '../bling/pedido-op.js';
import type { ImagemOp, OrdemProducao } from './tipos.js';

/** Arte escolhida na tela para o item (cor e máquinas já por nome). */
export type ArteEscolhida = { id: string; cor: string; maquinas: string[]; temImagem: boolean };

/** Um produto marcado para gerar a OP: o pedido lido, a posição do item nele e a arte, se houver. */
export type ItemGeracao = { pedido: PedidoOp; indice: number; arte?: ArteEscolhida };

export type StatusOp = 'pendente' | 'processando' | 'ok' | 'erro';

/** Resultado de uma OP, no mesmo formato do `DocResult` da Fatura (status, erro, passos, arquivos). */
export type ResultadoOp = {
  numero: string;
  indice: number;
  codigo: string;
  descricao: string;
  status: StatusOp;
  numeroOp?: number;
  arquivos?: string[];
  detalhe?: string;
  erro?: string;
  passos?: Passo[];
};

export type DepsGerarOps = {
  itens: readonly ItemGeracao[];
  /** Nome da empresa no cabeçalho do PDF; aparece quando não há `logo`. */
  empresa: string;
  /** Logo da empresa no cabeçalho de todas as OPs. */
  logo?: ImagemOp;
  agora?: () => Date;
  /** Reserva `quantidade` números consecutivos de OP (API da plataforma). */
  reservarNumeros: (quantidade: number) => Promise<number[]>;
  baixarImagem: (arteId: string) => Promise<ImagemOp>;
  /** Gera e grava o PDF; devolve o caminho do arquivo. */
  salvarPdf: (op: OrdemProducao) => Promise<string>;
  onProgresso?: (resultado: ResultadoOp) => void;
  /** Cada item que termina em erro (para o log do main). */
  onFalha?: (resultado: ResultadoOp, error: unknown) => void;
};

/** Monta o modelo do PDF de um item: Previsão inicial = data da venda; final = data prevista. */
export function montarOrdem(args: {
  pedido: PedidoOp;
  item: ItemOp;
  numero: number;
  data: Date;
  empresa: string;
  logo?: ImagemOp;
  arte?: ArteEscolhida;
  imagem?: ImagemOp;
}): OrdemProducao {
  const { pedido, item, numero, data, empresa, logo, arte, imagem } = args;
  return {
    numero,
    data,
    empresa,
    ...(logo ? { logo } : {}),
    cliente: { nome: pedido.clienteNome, fantasia: pedido.clienteFantasia },
    numeroPedido: pedido.numero,
    previsaoInicial: pedido.dataVenda,
    previsaoFinal: pedido.dataPrevista,
    item: {
      descricao: item.descricao,
      codigo: item.codigo,
      unidade: item.unidade,
      quantidade: item.quantidade,
    },
    insumos: item.insumos ?? [],
    arte: arte && { cor: arte.cor, maquinas: arte.maquinas, imagem },
  };
}

type EmPreparo = { indice: number; item: ItemOp; geracao: ItemGeracao; imagem?: ImagemOp };

/**
 * Gera uma OP (um PDF) por item marcado. Item sem insumos não reserva número nem gera PDF: vira erro
 * só dele. As imagens das artes são baixadas antes de reservar os números, para que uma falha de rede
 * não consuma números à toa. A falha de um item não interrompe os outros.
 */
export async function gerarOps(deps: DepsGerarOps): Promise<ResultadoOp[]> {
  const { itens, empresa, logo, agora = () => new Date(), onProgresso, onFalha } = deps;
  const resultados: ResultadoOp[] = itens.map(({ pedido, indice }) => {
    const item = pedido.itens[indice];
    return {
      numero: pedido.numero,
      indice,
      codigo: item?.codigo ?? '',
      descricao: item?.descricao ?? '',
      status: 'pendente',
    };
  });
  const atualizar = (posicao: number, patch: Partial<ResultadoOp>) => {
    const resultado = { ...resultados[posicao]!, ...patch };
    resultados[posicao] = resultado;
    onProgresso?.(resultado);
  };
  const falhar = (posicao: number, error: unknown, passos: Passo[] = []) => {
    atualizar(posicao, { status: 'erro', erro: primeiraLinha(error), passos });
    onFalha?.(resultados[posicao]!, error);
  };
  const rastros = itens.map(() => criarRastro());

  // 1. Itens com erro (sem insumos) ficam de fora; os outros baixam a imagem da arte.
  const prontos: EmPreparo[] = [];
  for (const [posicao, geracao] of itens.entries()) {
    const item = geracao.pedido.itens[geracao.indice];
    if (!item) {
      falhar(posicao, new Error('Item não encontrado no pedido'));
      continue;
    }
    if (item.erro || !item.insumos) {
      falhar(posicao, new Error(item.erro ?? 'Produto sem insumos cadastrados'));
      continue;
    }
    const { arte } = geracao;
    if (!arte?.temImagem) {
      prontos.push({ indice: posicao, item, geracao });
      continue;
    }
    atualizar(posicao, { status: 'processando' });
    const rastro = rastros[posicao]!;
    try {
      const imagem = await rastro.etapa('Baixei a imagem da arte', () =>
        deps.baixarImagem(arte.id),
      );
      prontos.push({ indice: posicao, item, geracao, imagem });
    } catch (error) {
      falhar(posicao, error, rastro.passos);
    }
  }
  if (!prontos.length) return resultados;

  // 2. Um número por OP que vai sair.
  let numeros: number[];
  try {
    numeros = await deps.reservarNumeros(prontos.length);
    if (numeros.length !== prontos.length) {
      throw new Error(`Reserva devolveu ${numeros.length} número(s) para ${prontos.length} OP(s)`);
    }
  } catch (error) {
    const erro = new Error(`Não foi possível reservar os números das OPs: ${primeiraLinha(error)}`);
    for (const { indice } of prontos) falhar(indice, erro, rastros[indice]!.passos);
    return resultados;
  }

  // 3. Um PDF por OP.
  const data = agora();
  for (const [i, { indice, item, geracao, imagem }] of prontos.entries()) {
    const numero = numeros[i]!;
    const rastro = rastros[indice]!;
    atualizar(indice, { status: 'processando', numeroOp: numero });
    try {
      const ordem = montarOrdem({
        pedido: geracao.pedido,
        item,
        numero,
        data,
        empresa,
        logo,
        arte: geracao.arte,
        imagem,
      });
      const arquivo = await rastro.etapa(`Gerei o PDF da OP nº ${numero}`, () =>
        deps.salvarPdf(ordem),
      );
      atualizar(indice, {
        status: 'ok',
        arquivos: [arquivo],
        detalhe: `OP nº ${numero}${geracao.arte ? '' : ' (sem arte)'}`,
        passos: rastro.passos,
      });
    } catch (error) {
      falhar(indice, error, rastro.passos);
    }
  }
  return resultados;
}
