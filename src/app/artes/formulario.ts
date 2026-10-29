import type { ArquivoEscolhido, ArtesApi } from '../api.js';
import type { ErrosCadastro } from '../plataforma/artes.js';
import {
  type Cliente,
  LIMITES,
  NOME_ARTE_MAX,
  NOME_PADRAO_ARTE,
  type Opcao,
  type TipoArquivo,
  validarNovaArte,
} from '../plataforma/contratos.js';
import { blocoErro, botao, criar, formatarTamanho, mensagemErro } from './dom.js';

export type DepsFormulario = {
  api: Pick<ArtesApi, 'opcoes' | 'escolherArquivo' | 'cadastrar'>;
  cliente: Cliente;
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

function opcoesMarcaveis(
  tipo: 'checkbox' | 'radio',
  nome: string,
  opcoes: Opcao[],
): { grupo: HTMLElement; marcados: () => string[] } {
  const grupo = criar('div', 'artes-opcoes');
  const inputs = opcoes.map((opcao) => {
    const rotulo = criar('label', 'check');
    const input = criar('input');
    input.type = tipo;
    input.name = nome;
    input.value = opcao.id;
    rotulo.append(input, opcao.nome);
    grupo.append(rotulo);
    return input;
  });
  return { grupo, marcados: () => inputs.filter((i) => i.checked).map((i) => i.value) };
}

/** Formulário de nova arte, com as mesmas regras e mensagens do site (`validarNovaArte`). */
export function montarFormulario(
  raiz: HTMLElement,
  { api, cliente, voltar, concluido }: DepsFormulario,
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
    const campoMaquinas = campo('Máquinas suportadas', maquinas.grupo, 'Marque uma ou as duas');
    const cores = opcoesMarcaveis('radio', 'cor', opcoes.cores);
    const campoCor = campo('Cor', cores.grupo);

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
        const resultado = await api.cadastrar({
          ...entrada,
          clienteId: cliente.id,
          pdfId: arquivos.pdf?.id,
          imagemId: arquivos.imagem?.id,
        });
        if (encerrado) return;
        if (resultado.ok) concluido();
        else mostrarErros(resultado.erros);
      } catch (erro) {
        mostrarErros({ geral: mensagemErro(erro) });
      } finally {
        salvar.disabled = false;
      }
    });

    return [criar('h2', undefined, `Nova arte — ${cliente.nomeExibicao}`), form];
  }

  void carregar();

  return {
    encerrar() {
      encerrado = true;
      card.remove();
    },
  };
}
