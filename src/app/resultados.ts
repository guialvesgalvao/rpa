import type { Passo } from '../core/rastro.js';

/** Status de um item gerado (documento da Fatura ou OP), como a tela mostra. */
export type StatusItem = 'pendente' | 'processando' | 'ok' | 'erro';

export const STATUS_LABEL: Record<StatusItem, string> = {
  pendente: 'Aguardando',
  processando: 'Processando…',
  ok: 'Concluído',
  erro: 'Erro',
};

export const nomeArquivo = (arquivo: string): string => arquivo.split(/[\\/]/).pop() ?? '';

export function div(className: string, texto: string): HTMLDivElement {
  const el = document.createElement('div');
  el.className = className;
  el.textContent = texto;
  return el;
}

/** Passo a passo do item com erro; o erro do passo só aparece se diferir do erro geral. */
export function renderPassos(passos: Passo[], erro: string | undefined): HTMLDetailsElement {
  const details = document.createElement('details');
  details.className = 'passos';
  details.open = true;
  const summary = document.createElement('summary');
  summary.textContent = 'Passo a passo';
  const lista = document.createElement('ol');
  for (const passo of passos) {
    const li = document.createElement('li');
    li.className = `passo ${passo.status}`;
    const marca = document.createElement('span');
    marca.className = 'marca';
    marca.textContent = passo.status === 'ok' ? '✔' : '✖';
    li.append(marca, passo.texto);
    if (passo.erro && passo.erro !== erro) li.append(div('passo-erro', passo.erro));
    lista.append(li);
  }
  details.append(summary, lista);
  return details;
}

type ItemResultado = {
  status: StatusItem;
  erro?: string;
  passos?: Passo[];
  arquivos?: string[];
  detalhe?: string;
};

/** Preenche as células de status e detalhe de uma linha de resultado. */
export function preencherResultado(
  status: HTMLTableCellElement,
  detalhe: HTMLTableCellElement,
  item: ItemResultado,
): void {
  const chip = document.createElement('span');
  chip.textContent = STATUS_LABEL[item.status];
  chip.className = `status ${item.status}`;
  status.replaceChildren(chip);

  const conteudo: Node[] = [];
  if (item.status === 'erro') {
    conteudo.push(div('erro-msg', item.erro ?? 'Erro desconhecido'));
    if (item.passos?.length) conteudo.push(renderPassos(item.passos, item.erro));
  } else {
    for (const arquivo of item.arquivos ?? []) conteudo.push(div('arquivo', nomeArquivo(arquivo)));
    if (item.detalhe) conteudo.push(div('', item.detalhe));
  }
  detalhe.replaceChildren(...conteudo);
}
