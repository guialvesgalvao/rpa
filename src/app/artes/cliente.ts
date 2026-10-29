import type { ArtesApi } from '../api.js';
import { type Cliente, rotuloArtes } from '../plataforma/contratos.js';
import { blocoErro, botao, criar, formatarCnpj, mensagemErro } from './dom.js';

export type DepsCliente = {
  api: Pick<ArtesApi, 'obterCliente' | 'produtosDoCliente'>;
  clienteId: string;
  /** Mensagem de sucesso mostrada no topo (ex.: "Arte cadastrada"). */
  sucesso?: string;
  voltar: () => void;
  cadastrar: (cliente: Cliente) => void;
};

/** Página do cliente: os produtos que têm arte, com o contador, e o botão de nova arte. */
export function montarCliente(
  raiz: HTMLElement,
  { api, clienteId, sucesso, voltar, cadastrar }: DepsCliente,
): { encerrar(): void } {
  let encerrado = false;
  const card = criar('div', 'card');
  raiz.append(card);

  async function carregar() {
    card.replaceChildren(criar('div', 'hint', 'Carregando…'));
    try {
      const [cliente, produtos] = await Promise.all([
        api.obterCliente(clienteId),
        api.produtosDoCliente(clienteId),
      ]);
      if (encerrado) return;

      const topo = criar('div', 'artes-topo');
      topo.append(botao('Voltar', voltar));
      const detalhe = criar('div', 'hint');
      detalhe.textContent = `${cliente.razaoSocial} · ${formatarCnpj(cliente.cnpj)}`;
      const itens = produtos.length
        ? criar('ul', 'artes-produtos')
        : criar('div', 'hint', 'Nenhuma arte cadastrada para este cliente.');
      for (const produto of produtos) {
        const li = criar('li');
        li.append(
          criar('span', undefined, produto.nome),
          criar('span', 'artes-contador', rotuloArtes(produto.quantidadeArtes)),
        );
        itens.append(li);
      }
      card.replaceChildren(
        topo,
        criar('h2', undefined, cliente.nomeExibicao),
        detalhe,
        ...(sucesso ? [criar('div', 'artes-sucesso', sucesso)] : []),
        itens,
        botao('Cadastrar nova arte', () => cadastrar(cliente), 'primary'),
      );
    } catch (erro) {
      if (encerrado) return;
      card.replaceChildren(
        botao('Voltar', voltar),
        blocoErro(mensagemErro(erro), () => void carregar()),
      );
    }
  }

  void carregar();

  return {
    encerrar() {
      encerrado = true;
      card.remove();
    },
  };
}
