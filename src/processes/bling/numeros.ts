export type NumerosParseados = {
  /** Números válidos, sem duplicados, na ordem em que apareceram. */
  validos: string[];
  /** Entradas que não são números de pedido (só dígitos). */
  invalidos: string[];
};

/** Interpreta a lista colada pelo usuário: aceita um por linha, ou separados por vírgula, ponto e vírgula ou espaço. */
export function parseNumeros(texto: string): NumerosParseados {
  const validos = new Set<string>();
  const invalidos = new Set<string>();
  for (const parte of texto.split(/[\s,;]+/)) {
    const valor = parte.trim();
    if (!valor) continue;
    if (/^\d+$/.test(valor)) validos.add(valor);
    else invalidos.add(valor);
  }
  return { validos: [...validos], invalidos: [...invalidos] };
}
