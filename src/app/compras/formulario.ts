import type { ComprasApi } from '../api.js';
import { blocoErro, botao, criar, mensagemErro } from '../artes/dom.js';
import {
  type EdicaoPedidoCompra,
  filtrarInsumos,
  type Insumo,
  lerQuantidade,
  OBSERVACAO_COMPRA_MAX,
  type PedidoCompra,
  quantidadeParaCampo,
  rotuloInsumo,
} from '../plataforma/contratos.js';

export type DepsFormularioPedido = {
  api: Pick<ComprasApi, 'insumos' | 'criar' | 'editar'>;
  /** Sem pedido: novo pedido. Com pedido: edição (insumo, quantidade e observação). */
  pedido?: PedidoCompra;
  /** Trocar o insumo depende da lista de insumos, que é de quem pede (`compras.pedir`). */
  podeTrocarInsumo: boolean;
  voltar: () => void;
  concluido: (pedido: PedidoCompra) => void;
};

/** O que o formulário envia: no novo pedido, tudo; na edição, só o que mudou. `erro` quando algo não vale. */
export function dadosDoFormulario(
  campos: { insumoId: string; quantidade: string; observacao: string },
  pedido?: Pick<PedidoCompra, 'insumo' | 'quantidade' | 'observacao'>,
): { erro: string } | { dados: EdicaoPedidoCompra } {
  if (!campos.insumoId) return { erro: 'Escolha o insumo.' };
  const quantidade = lerQuantidade(campos.quantidade);
  if (quantidade === undefined) {
    return { erro: 'Informe uma quantidade maior que zero, com até 3 casas decimais.' };
  }
  const observacao = campos.observacao.trim() || null;
  if (observacao && observacao.length > OBSERVACAO_COMPRA_MAX) {
    return { erro: `A observação aceita até ${OBSERVACAO_COMPRA_MAX} caracteres.` };
  }
  if (!pedido) return { dados: { insumoId: campos.insumoId, quantidade, observacao } };
  const dados: EdicaoPedidoCompra = {};
  if (campos.insumoId !== pedido.insumo.id) dados.insumoId = campos.insumoId;
  if (quantidade !== pedido.quantidade) dados.quantidade = quantidade;
  if (observacao !== pedido.observacao) dados.observacao = observacao;
  if (Object.keys(dados).length === 0) return { erro: 'Nada foi alterado.' };
  return { dados };
}

/** Novo pedido ou edição: insumo (busca na lista TPP), quantidade e observação. */
export function montarFormularioPedido(
  raiz: HTMLElement,
  { api, pedido, podeTrocarInsumo, voltar, concluido }: DepsFormularioPedido,
): { encerrar(): void } {
  let encerrado = false;
  const card = criar('div', 'card');
  raiz.append(card);

  async function carregar() {
    card.replaceChildren(criar('div', 'hint', 'Carregando…'));
    try {
      const insumos = podeTrocarInsumo ? await api.insumos() : [];
      if (encerrado) return;
      desenhar(insumos);
    } catch (erro) {
      if (encerrado) return;
      card.replaceChildren(
        botao('Voltar', voltar),
        blocoErro(mensagemErro(erro), () => void carregar()),
      );
    }
  }

  function desenhar(insumos: Insumo[]) {
    const campoInsumo = criar('div', 'artes-campo');
    const insumo = criar('select');
    insumo.setAttribute('aria-label', 'Insumo');
    if (podeTrocarInsumo) {
      const busca = criar('input');
      busca.type = 'search';
      busca.placeholder = 'Buscar por código ou nome';
      busca.setAttribute('aria-label', 'Buscar insumo');
      const preencher = () => {
        const atual = insumo.value || pedido?.insumo.id || '';
        insumo.replaceChildren(new Option('Selecione o insumo', ''));
        const encontrados = filtrarInsumos(insumos, busca.value);
        // O insumo atual continua na lista mesmo fora da busca, para não trocar sem querer.
        const atualFora = atual && !encontrados.some((i) => i.id === atual);
        const visiveis = atualFora
          ? [...insumos.filter((i) => i.id === atual), ...encontrados]
          : encontrados;
        for (const i of visiveis) insumo.append(new Option(rotuloInsumo(i), i.id));
        insumo.value = atual;
      };
      busca.addEventListener('input', preencher);
      preencher();
      campoInsumo.append(criar('label', undefined, 'Insumo'), busca, insumo);
      if (insumos.length === 0) {
        campoInsumo.append(
          criar('div', 'hint warn', 'Nenhum insumo (código TPP) sincronizado do Bling.'),
        );
      }
    } else if (pedido) {
      insumo.append(new Option(rotuloInsumo(pedido.insumo), pedido.insumo.id));
      insumo.disabled = true;
      campoInsumo.append(criar('label', undefined, 'Insumo'), insumo);
    }

    const quantidade = criar('input');
    quantidade.inputMode = 'decimal';
    quantidade.setAttribute('aria-label', 'Quantidade');
    quantidade.placeholder = 'Ex.: 10 ou 2,5';
    if (pedido) quantidade.value = quantidadeParaCampo(pedido.quantidade);
    const campoQuantidade = criar('div', 'artes-campo');
    campoQuantidade.append(criar('label', undefined, 'Quantidade'), quantidade);

    const observacao = criar('textarea');
    observacao.rows = 3;
    observacao.maxLength = OBSERVACAO_COMPRA_MAX;
    observacao.setAttribute('aria-label', 'Observação');
    observacao.value = pedido?.observacao ?? '';
    const campoObservacao = criar('div', 'artes-campo');
    campoObservacao.append(criar('label', undefined, 'Observação (opcional)'), observacao);

    const erro = criar('div', 'hint warn');
    erro.setAttribute('role', 'alert');
    const salvar = botao(
      pedido ? 'Salvar alterações' : 'Fazer pedido',
      async () => {
        const lido = dadosDoFormulario(
          { insumoId: insumo.value, quantidade: quantidade.value, observacao: observacao.value },
          pedido,
        );
        if ('erro' in lido) {
          erro.textContent = lido.erro;
          return;
        }
        salvar.disabled = true;
        erro.textContent = '';
        try {
          const salvo = pedido
            ? await api.editar(pedido.id, lido.dados)
            : await api.criar({
                insumoId: lido.dados.insumoId ?? '',
                quantidade: lido.dados.quantidade ?? 0,
                observacao: lido.dados.observacao ?? null,
              });
          if (!encerrado) concluido(salvo);
        } catch (falha) {
          erro.textContent = mensagemErro(falha);
          salvar.disabled = false;
        }
      },
      'primary',
    );
    const acoes = criar('div', 'actions');
    acoes.append(salvar, botao('Cancelar', voltar));

    const form = criar('div', 'artes-form');
    form.append(campoInsumo, campoQuantidade, campoObservacao, erro, acoes);
    const topo = criar('div', 'artes-topo');
    topo.append(botao('Voltar', voltar));
    card.replaceChildren(
      topo,
      criar('h2', undefined, pedido ? 'Editar pedido' : 'Novo pedido de compra'),
      form,
    );
  }

  void carregar();

  return {
    encerrar() {
      encerrado = true;
      card.remove();
    },
  };
}
