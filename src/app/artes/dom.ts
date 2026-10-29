/** Elemento com classe e texto opcionais (sempre `textContent`, nunca HTML). */
export function criar<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  classe?: string,
  texto?: string,
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (classe) el.className = classe;
  if (texto !== undefined) el.textContent = texto;
  return el;
}

export function botao(texto: string, aoClicar: () => void, classe?: string): HTMLButtonElement {
  const el = criar('button', classe, texto);
  el.type = 'button';
  el.addEventListener('click', aoClicar);
  return el;
}

// O Electron prefixa a mensagem com "Error invoking remote method '...': Error: ".
export const mensagemErro = (error: unknown): string =>
  (error as Error).message.replace(/^.*?Error: /, '');

/** 12345678000195 → 12.345.678/0001-95 */
export const formatarCnpj = (cnpj: string): string =>
  cnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');

export function formatarTamanho(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`;
}

/** Bloco de erro com "Tentar de novo", usado por lista, cliente e formulário. */
export function blocoErro(mensagem: string, tentarDeNovo: () => void): HTMLElement {
  const bloco = criar('div', 'artes-estado');
  bloco.append(criar('div', 'hint warn', mensagem), botao('Tentar de novo', tentarDeNovo));
  return bloco;
}
