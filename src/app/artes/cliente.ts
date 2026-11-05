import type { ArtesApi } from '../api.js';
import { type Cliente, type Opcao, rotuloArtes } from '../plataforma/contratos.js';
import { blocoErro, botao, criar, formatarCnpj, mensagemErro } from './dom.js';

export type DepsCliente = {
  api: Pick<ArtesApi, 'obterCliente' | 'produtosDoCliente' | 'opcoes'>;
  clienteId: string;
  /** Mensagem de sucesso mostrada no topo (ex.: "Arte cadastrada"). */
  sucesso?: string;
  voltar: () => void;
  /** "Inserir arte pronta": o formulário de nova arte, com o produto já escolhido. */
  cadastrar: (cliente: Cliente, produtoId?: string) => void;
  /** "Iniciar o desenvolvimento": cria a tarefa do produto para o cliente e a abre. */
  iniciarTarefa: (cliente: Cliente, produtoId: string) => Promise<void>;
};

/**
 * "Novo trabalho de arte": um produto do catálogo da empresa (o mesmo para todos os clientes) e as
 * duas saídas, inserir uma arte pronta ou iniciar o desenvolvimento (tarefa).
 */
function blocoNovoTrabalho(
  cliente: Cliente,
  catalogo: Opcao[],
  { cadastrar, iniciarTarefa }: Pick<DepsCliente, 'cadastrar' | 'iniciarTarefa'>,
): HTMLElement {
  const produto = criar('select');
  produto.setAttribute('aria-label', 'Produto do catálogo');
  produto.append(new Option('Selecione um produto do catálogo', ''));
  for (const { id, nome } of catalogo) produto.append(new Option(nome, id));
  const erro = criar('div', 'hint warn');
  erro.setAttribute('role', 'alert');

  const escolhido = (): string | undefined => {
    erro.textContent = produto.value ? '' : 'Selecione um produto do catálogo.';
    return produto.value || undefined;
  };
  const pronta = botao('Inserir arte pronta', () => {
    const produtoId = escolhido();
    if (produtoId) cadastrar(cliente, produtoId);
  });
  const iniciar = botao(
    'Iniciar desenvolvimento',
    async () => {
      const produtoId = escolhido();
      if (!produtoId) return;
      iniciar.disabled = true;
      try {
        await iniciarTarefa(cliente, produtoId);
      } catch (falha) {
        erro.textContent = mensagemErro(falha);
        iniciar.disabled = false;
      }
    },
    'primary',
  );
  const acoes = criar('div', 'actions');
  acoes.append(pronta, iniciar);

  const bloco = criar('div', 'artes-campo artes-novo-trabalho');
  bloco.append(
    criar('label', undefined, 'Novo trabalho de arte'),
    produto,
    criar(
      'div',
      'hint',
      'Insira uma arte que já existe ou inicie o desenvolvimento: a tarefa registra o andamento até a arte ficar pronta.',
    ),
    erro,
    acoes,
  );
  return bloco;
}

/** Página do cliente: os produtos que têm arte, com o contador, e o novo trabalho de arte. */
export function montarCliente(
  raiz: HTMLElement,
  { api, clienteId, sucesso, voltar, cadastrar, iniciarTarefa }: DepsCliente,
): { encerrar(): void } {
  let encerrado = false;
  const card = criar('div', 'card');
  raiz.append(card);

  async function carregar() {
    card.replaceChildren(criar('div', 'hint', 'Carregando…'));
    try {
      const [cliente, produtos, opcoes] = await Promise.all([
        api.obterCliente(clienteId),
        api.produtosDoCliente(clienteId),
        api.opcoes(),
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
        blocoNovoTrabalho(cliente, opcoes.produtos, { cadastrar, iniciarTarefa }),
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
