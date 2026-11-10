import type { ArquivoEscolhido, ArtesApi, CadastroArte, CadastroResultado } from '../api.js';
import type { ErrosCadastro } from '../plataforma/artes.js';
import {
  chaveDaCor,
  type Cliente,
  LIMITES,
  NOME_ARTE_MAX,
  NOME_COR_MAX,
  NOME_PADRAO_ARTE,
  type Opcao,
  type TipoArquivo,
  validarNovaArte,
  validarNovaCor,
} from '../plataforma/contratos.js';
import { blocoErro, botao, criar, formatarTamanho, mensagemErro } from './dom.js';

export type DepsFormulario = {
  api: Pick<ArtesApi, 'opcoes' | 'criarCor' | 'escolherArquivo' | 'cadastrar'>;
  cliente: Pick<Cliente, 'id' | 'nomeExibicao'>;
  /** Produto já escolhido ao abrir (ex.: o item da OP); o usuário pode trocar, salvo com `produtoFixo`. */
  produtoId?: string;
  /**
   * O produto não muda (ex.: conclusão de tarefa: é o da tarefa). Se ele não estiver no catálogo
   * listado (ex.: inativado no Bling), entra como opção com este nome.
   */
  produtoFixo?: { nome: string };
  /** Título do cartão; padrão: "Nova arte — <cliente>". */
  titulo?: string;
  /** Envio no lugar do cadastro comum (ex.: concluir a tarefa com a arte). */
  enviar?: (entrada: Omit<CadastroArte, 'clienteId'>) => Promise<CadastroResultado>;
  voltar: () => void;
  concluido: () => void;
};

const MB = 1024 * 1024;

type Campo = { raiz: HTMLElement; erro: HTMLElement };

/** Rótulo, controle, ajuda e o espaço do erro ao lado do campo. */
function campo(rotulo: string, controle: HTMLElement, ajuda?: string): Campo {
  const raiz = criar('div', 'artes-campo');
  const titulo = criar('label', undefined, rotulo);
  const erro = criar('div', 'hint warn');
  erro.setAttribute('role', 'alert');
  raiz.append(titulo, controle);
  if (ajuda) raiz.append(criar('div', 'hint', ajuda));
  raiz.append(erro);
  return { raiz, erro };
}

type Marcaveis = {
  grupo: HTMLElement;
  marcados: () => string[];
  /** Acrescenta uma opção ao fim do grupo (ex.: a cor recém-criada). */
  adicionar: (opcao: Opcao) => void;
  marcar: (id: string) => void;
};

function opcoesMarcaveis(tipo: 'checkbox' | 'radio', nome: string, opcoes: Opcao[]): Marcaveis {
  const grupo = criar('div', 'artes-opcoes');
  const inputs: HTMLInputElement[] = [];
  const adicionar = (opcao: Opcao) => {
    const rotulo = criar('label', 'check');
    const input = criar('input');
    input.type = tipo;
    input.name = nome;
    input.value = opcao.id;
    rotulo.append(input, opcao.nome);
    grupo.append(rotulo);
    inputs.push(input);
  };
  opcoes.forEach(adicionar);
  return {
    grupo,
    marcados: () => inputs.filter((i) => i.checked).map((i) => i.value),
    adicionar,
    marcar: (id) => {
      for (const input of inputs) if (input.value === id) input.checked = true;
    },
  };
}

/**
 * "+ Nova cor": cria a cor pela API (só o nome) e a seleciona. Se o nome já existe na lista (sem
 * maiúsculas nem acentos), só seleciona a existente.
 */
function blocoNovaCor(
  criarCor: ArtesApi['criarCor'],
  cores: Opcao[],
  marcaveis: Marcaveis,
  erroCampo: HTMLElement,
): HTMLElement {
  const bloco = criar('div', 'artes-nova-cor');
  const linha = criar('div', 'artes-nova-cor-linha');
  const nome = criar('input');
  nome.type = 'text';
  nome.maxLength = NOME_COR_MAX;
  nome.setAttribute('aria-label', 'Nome da nova cor');
  const erro = criar('div', 'hint warn');
  erro.setAttribute('role', 'alert');

  const fechar = () => {
    nome.value = '';
    erro.textContent = '';
    linha.hidden = true;
    abrir.hidden = false;
  };
  const escolher = (cor: Opcao) => {
    marcaveis.marcar(cor.id);
    erroCampo.textContent = '';
    fechar();
  };

  const adicionar = botao('Adicionar', async () => {
    const invalido = validarNovaCor(nome.value);
    if (invalido) {
      erro.textContent = invalido;
      return;
    }
    const existente = cores.find((cor) => chaveDaCor(cor.nome) === chaveDaCor(nome.value));
    if (existente) {
      escolher(existente);
      return;
    }
    erro.textContent = '';
    adicionar.disabled = true;
    cancelar.disabled = true;
    adicionar.textContent = 'Adicionando…';
    try {
      const cor = await criarCor(nome.value.trim());
      cores.push(cor);
      marcaveis.adicionar(cor);
      escolher(cor);
    } catch (falha) {
      erro.textContent = mensagemErro(falha);
    } finally {
      adicionar.disabled = false;
      cancelar.disabled = false;
      adicionar.textContent = 'Adicionar';
    }
  });
  const cancelar = botao('Cancelar', fechar);
  // Enter cria a cor em vez de enviar o formulário da arte.
  nome.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    adicionar.click();
  });
  const abrir = botao(
    '+ Nova cor',
    () => {
      abrir.hidden = true;
      linha.hidden = false;
      nome.focus();
    },
    'artes-nova-cor-abrir',
  );
  linha.append(nome, adicionar, cancelar);
  linha.hidden = true;
  bloco.append(abrir, linha, erro);
  return bloco;
}

/** Formulário de nova arte, com as mesmas regras e mensagens do site (`validarNovaArte`). */
export function montarFormulario(
  raiz: HTMLElement,
  { api, cliente, produtoId, produtoFixo, titulo, enviar, voltar, concluido }: DepsFormulario,
): { encerrar(): void } {
  let encerrado = false;
  const card = criar('div', 'card');
  raiz.append(card);

  async function carregar() {
    card.replaceChildren(criar('div', 'hint', 'Carregando…'));
    try {
      const opcoes = await api.opcoes();
      if (encerrado) return;
      card.replaceChildren(...montar(opcoes));
    } catch (erro) {
      if (encerrado) return;
      card.replaceChildren(
        botao('Voltar', voltar),
        blocoErro(mensagemErro(erro), () => void carregar()),
      );
    }
  }

  function montar(opcoes: Awaited<ReturnType<ArtesApi['opcoes']>>): HTMLElement[] {
    const arquivos: Partial<Record<TipoArquivo, ArquivoEscolhido>> = {};

    const produto = criar('select');
    produto.append(new Option('Selecione um produto', ''));
    for (const { id, nome } of opcoes.produtos) produto.append(new Option(nome, id));
    if (produtoId && produtoFixo && !opcoes.produtos.some((p) => p.id === produtoId)) {
      produto.append(new Option(produtoFixo.nome, produtoId));
    }
    if (produtoId && [...produto.options].some((o) => o.value === produtoId)) {
      produto.value = produtoId;
    }
    produto.disabled = Boolean(produtoFixo);
    const campoProduto = campo('Produto', produto);

    const nome = criar('input');
    nome.type = 'text';
    nome.placeholder = NOME_PADRAO_ARTE;
    nome.maxLength = NOME_ARTE_MAX;
    const campoNome = campo(
      'Nome',
      nome,
      `Se ficar em branco, a arte será salva como '${NOME_PADRAO_ARTE}'`,
    );

    const seletor = (tipo: TipoArquivo, rotulo: string, limite: string) => {
      const linha = criar('div', 'artes-arquivo');
      const escolhido = criar('span', 'hint', 'Nenhum arquivo');
      const remover = botao('Remover', () => {
        delete arquivos[tipo];
        escolhido.textContent = 'Nenhum arquivo';
        remover.hidden = true;
      });
      remover.hidden = true;
      const escolher = botao(`Escolher ${rotulo}…`, async () => {
        escolher.disabled = true;
        try {
          const arquivo = await api.escolherArquivo(tipo);
          if (!arquivo) return;
          arquivos[tipo] = arquivo;
          escolhido.textContent = `${arquivo.nome} (${formatarTamanho(arquivo.tamanho)})`;
          remover.hidden = false;
        } catch (erro) {
          erroGeral.textContent = mensagemErro(erro);
        } finally {
          escolher.disabled = false;
        }
      });
      linha.append(escolher, escolhido, remover);
      const bloco = criar('div');
      bloco.append(criar('div', 'hint', `${rotulo}: ${limite}`), linha);
      return bloco;
    };
    const erroArquivos = criar('div', 'hint warn');
    erroArquivos.setAttribute('role', 'alert');
    const campoArquivos = criar('div', 'artes-campo');
    campoArquivos.append(
      criar('label', undefined, 'Arquivos'),
      seletor('pdf', 'PDF', `até ${LIMITES.pdfBytes / MB} MB`),
      seletor('imagem', 'Imagem', `PNG, JPEG ou WebP, até ${LIMITES.imagemBytes / MB} MB`),
      criar('div', 'hint', 'Envie ao menos um arquivo'),
      erroArquivos,
    );

    const maquinas = opcoesMarcaveis('checkbox', 'maquina', opcoes.maquinas);
    const campoMaquinas = campo('Máquinas suportadas', maquinas.grupo, 'Marque uma ou mais');
    const cores = opcoesMarcaveis('radio', 'cor', opcoes.cores);
    const campoCor = campo('Cor', cores.grupo);
    campoCor.raiz.insertBefore(
      blocoNovaCor(api.criarCor, [...opcoes.cores], cores, campoCor.erro),
      campoCor.erro,
    );

    const erroGeral = criar('div', 'hint warn');
    erroGeral.setAttribute('role', 'alert');
    const salvar = criar('button', 'primary', 'Salvar');
    salvar.type = 'submit';
    const form = criar('form', 'artes-form');
    const acoes = criar('div', 'actions');
    acoes.append(salvar, botao('Cancelar', voltar));
    form.append(
      campoProduto.raiz,
      campoNome.raiz,
      campoArquivos,
      campoMaquinas.raiz,
      campoCor.raiz,
      erroGeral,
      acoes,
    );

    const mostrarErros = (erros: ErrosCadastro) => {
      campoProduto.erro.textContent = erros.produtoId ?? '';
      campoNome.erro.textContent = erros.nome ?? '';
      erroArquivos.textContent = erros.arquivos ?? '';
      campoMaquinas.erro.textContent = erros.maquinaIds ?? '';
      campoCor.erro.textContent = erros.corId ?? '';
      erroGeral.textContent = erros.geral ?? '';
    };

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const [corId = ''] = cores.marcados();
      const entrada = {
        produtoId: produto.value,
        nome: nome.value,
        corId,
        maquinaIds: maquinas.marcados(),
      };
      const resumo = (a?: ArquivoEscolhido) => a && { tamanho: a.tamanho, tipo: a.tipo };
      const erros = validarNovaArte({
        ...entrada,
        pdf: resumo(arquivos.pdf),
        imagem: resumo(arquivos.imagem),
      });
      mostrarErros(erros);
      if (Object.keys(erros).length > 0) return;

      salvar.disabled = true;
      try {
        const dados = { ...entrada, pdfId: arquivos.pdf?.id, imagemId: arquivos.imagem?.id };
        const resultado = enviar
          ? await enviar(dados)
          : await api.cadastrar({ ...dados, clienteId: cliente.id });
        if (encerrado) return;
        if (resultado.ok) concluido();
        else mostrarErros(resultado.erros);
      } catch (erro) {
        mostrarErros({ geral: mensagemErro(erro) });
      } finally {
        salvar.disabled = false;
      }
    });

    return [criar('h2', undefined, titulo ?? `Nova arte — ${cliente.nomeExibicao}`), form];
  }

  void carregar();

  return {
    encerrar() {
      encerrado = true;
      card.remove();
    },
  };
}
