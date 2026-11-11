import type { ComprasApi } from '../api.js';
import { type EscopoCompras, type StatusCompra, temPermissao } from '../plataforma/contratos.js';
import { montarFormularioPedido } from './formulario.js';
import { montarHistoricoPedido } from './historico.js';
import { montarPedido } from './pedido.js';
import { montarPedidos } from './pedidos.js';

type Visao = { encerrar(): void };

/**
 * Navegação da aba Compras: lista → novo pedido; lista → pedido → edição ou histórico. A lista lembra o último
 * filtro enquanto a aba está montada; `reiniciar` volta ao padrão (troca de empresa ou de usuário).
 */
export function criarCompras(
  raiz: HTMLElement,
  api: ComprasApi,
): { reiniciar(permissoes: readonly string[]): void; encerrar(): void } {
  let visao: Visao | undefined;
  let permissoes: readonly string[] = [];
  let filtro: { escopo: EscopoCompras; status?: StatusCompra } = { escopo: 'meus' };

  function mostrar(abrir: () => Visao) {
    visao?.encerrar();
    visao = abrir();
  }

  function mostrarLista() {
    mostrar(() =>
      montarPedidos(raiz, {
        api,
        permissoes,
        filtro,
        aoFiltrar: (novo) => (filtro = novo),
        novo: mostrarNovo,
        abrir: (pedido) => mostrarPedido(pedido.id),
      }),
    );
  }

  function mostrarNovo() {
    mostrar(() =>
      montarFormularioPedido(raiz, {
        api,
        podeTrocarInsumo: true,
        voltar: mostrarLista,
        concluido: (pedido) => mostrarPedido(pedido.id, 'Pedido criado'),
      }),
    );
  }

  function mostrarPedido(pedidoId: string, sucesso?: string) {
    const deNovo = (mensagem?: string) => mostrarPedido(pedidoId, mensagem);
    mostrar(() =>
      montarPedido(raiz, {
        api,
        pedidoId,
        sucesso,
        voltar: mostrarLista,
        editar: (pedido) =>
          mostrar(() =>
            montarFormularioPedido(raiz, {
              api,
              pedido,
              podeTrocarInsumo: temPermissao(permissoes, 'compras.pedir'),
              voltar: () => deNovo(),
              concluido: () => deNovo('Pedido atualizado'),
            }),
          ),
        historico: (pedido) =>
          mostrar(() => montarHistoricoPedido(raiz, { api, pedido, voltar: () => deNovo() })),
      }),
    );
  }

  function encerrar() {
    visao?.encerrar();
    visao = undefined;
  }

  return {
    encerrar,
    reiniciar(novas) {
      encerrar();
      permissoes = novas;
      filtro = { escopo: 'meus' };
      mostrarLista();
    },
  };
}
