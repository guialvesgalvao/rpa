import {
  LIMITES_PREENCHIMENTO,
  type LinhaProcessoPreenchida,
  normalizarPreenchimento,
} from '../../processes/op/preenchimento.js';
import { PASSOS_PROCESSO } from '../../processes/op/template.js';
import type { PreenchimentoOp } from '../api.js';
import { botao, criar } from '../artes/dom.js';

export type DepsPreenchimento = {
  /** Ex.: "Pedido 101 · XX0001 — Caixa de pizza 35x35". */
  titulo: string;
  inicial?: PreenchimentoOp;
  /** `undefined` = sem dados: a OP volta a sair em branco. */
  salvar: (preenchimento: PreenchimentoOp | undefined) => void;
  voltar: () => void;
};

function campoData(valor: string | undefined, rotulo: string): HTMLInputElement {
  const input = criar('input');
  input.type = 'date';
  input.value = valor ?? '';
  input.setAttribute('aria-label', rotulo);
  return input;
}

function campoTexto(valor: string | undefined, max: number, rotulo: string): HTMLInputElement {
  const input = criar('input');
  input.type = 'text';
  input.maxLength = max;
  input.value = valor ?? '';
  input.setAttribute('aria-label', rotulo);
  return input;
}

type LinhaTela = { ler(): LinhaProcessoPreenchida; limpar(): void; tr: HTMLTableRowElement };

function linhaDoPasso(
  passo: string,
  posicao: number,
  inicial?: LinhaProcessoPreenchida,
): LinhaTela {
  const tr = criar('tr');
  const aplica = criar('select');
  aplica.setAttribute('aria-label', `${passo}: Sim ou Não`);
  aplica.append(new Option('—', ''), new Option('Sim', 'sim'), new Option('Não', 'nao'));
  aplica.value = inicial?.aplica ?? '';
  const quantidade = campoTexto(
    inicial?.quantidade,
    LIMITES_PREENCHIMENTO.quantidade,
    `${passo}: quantidade`,
  );
  const responsavel = campoTexto(
    inicial?.responsavel,
    LIMITES_PREENCHIMENTO.responsavel,
    `${passo}: responsável`,
  );
  const data = campoData(inicial?.data, `${passo}: data`);
  const celulas = [aplica, quantidade, responsavel, data].map((controle) => {
    const td = criar('td');
    td.append(controle);
    return td;
  });
  tr.append(criar('td', 'op-passo', `${posicao}) ${passo}`), ...celulas);
  return {
    tr,
    ler: () => ({
      ...(aplica.value === 'sim' || aplica.value === 'nao' ? { aplica: aplica.value } : {}),
      quantidade: quantidade.value,
      responsavel: responsavel.value,
      data: data.value,
    }),
    limpar() {
      for (const el of [aplica, quantidade, responsavel, data]) el.value = '';
    },
  };
}

/**
 * Formulário "Pré-preencher OP": data de entrega, Descrição do Processo (sem o Visto) e Observação.
 * Abre no lugar da lista; o que for salvo vale só para a próxima geração desta OP.
 */
export function montarPreenchimento(
  raiz: HTMLElement,
  { titulo, inicial, salvar, voltar }: DepsPreenchimento,
): { encerrar(): void } {
  const card = criar('div', 'card');

  const dataEntrega = campoData(inicial?.dataEntrega, 'Data entrega de produção');
  const campoEntrega = criar('div', 'artes-campo');
  campoEntrega.append(criar('label', undefined, 'Data entrega de produção'), dataEntrega);

  const linhas = PASSOS_PROCESSO.map((passo, i) =>
    linhaDoPasso(passo, i + 1, inicial?.processo?.[i]),
  );
  const tabela = criar('table', 'op-preenchimento-processo');
  const cabecalho = criar('tr');
  for (const rotulo of ['Passo', 'Sim/Não', 'Quantidade', 'Responsável', 'Data']) {
    cabecalho.append(criar('th', undefined, rotulo));
  }
  const thead = criar('thead');
  thead.append(cabecalho);
  const tbody = criar('tbody');
  tbody.append(...linhas.map((l) => l.tr));
  tabela.append(thead, tbody);
  const campoProcesso = criar('div', 'artes-campo');
  campoProcesso.append(
    criar('label', undefined, 'Descrição do Processo'),
    tabela,
    criar('div', 'hint', 'O Visto continua em branco, para preencher no papel.'),
  );

  const observacao = criar('textarea');
  observacao.rows = 4;
  observacao.maxLength = LIMITES_PREENCHIMENTO.observacao;
  observacao.value = inicial?.observacao ?? '';
  observacao.setAttribute('aria-label', 'Observação');
  const contador = criar('div', 'hint');
  const contar = () => {
    contador.textContent = `${observacao.value.length} de ${LIMITES_PREENCHIMENTO.observacao} caracteres, até ${LIMITES_PREENCHIMENTO.linhasObservacao} linhas`;
  };
  observacao.addEventListener('input', contar);
  contar();
  const campoObservacao = criar('div', 'artes-campo');
  campoObservacao.append(criar('label', undefined, 'Observação'), observacao, contador);

  const form = criar('form', 'artes-form');
  const salvarBotao = criar('button', 'primary', 'Salvar');
  salvarBotao.type = 'submit';
  const acoes = criar('div', 'actions');
  acoes.append(
    salvarBotao,
    botao('Limpar tudo', () => {
      dataEntrega.value = '';
      for (const linha of linhas) linha.limpar();
      observacao.value = '';
      contar();
    }),
    botao('Cancelar', voltar),
  );
  form.append(campoEntrega, campoProcesso, campoObservacao, acoes);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    salvar(
      normalizarPreenchimento({
        dataEntrega: dataEntrega.value,
        processo: linhas.map((l) => l.ler()),
        observacao: observacao.value,
      }),
    );
  });

  card.append(
    criar('h2', undefined, `Dados da OP — ${titulo}`),
    criar('div', 'hint', 'Campos em branco saem em branco no PDF, para preencher à mão.'),
    form,
  );
  raiz.append(card);
  return { encerrar: () => card.remove() };
}
