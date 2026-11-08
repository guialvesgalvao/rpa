import { ANEXOS_POR_COMENTARIO, LIMITES } from '@plataforma/contratos';

// Tipos que o campo de anexos oferece; a API confere de novo pelos primeiros bytes.
export const ACEITOS_ANEXO =
  'application/pdf,.pdf,image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp';

const MB = 1024 * 1024;

const ehPdf = (arquivo: { name: string; type: string }) =>
  arquivo.type === 'application/pdf' || arquivo.name.toLowerCase().endsWith('.pdf');

// Conferência antes do envio (a API repete): texto ou anexo, quantidade e tamanho por tipo. `undefined` = ok.
export function problemaDosAnexos(
  texto: string,
  anexos: readonly { name: string; type: string; size: number }[],
): string | undefined {
  if (!texto.trim() && anexos.length === 0) return 'Escreva o comentário ou anexe um arquivo.';
  if (anexos.length > ANEXOS_POR_COMENTARIO) {
    return `Anexe no máximo ${ANEXOS_POR_COMENTARIO} arquivos por comentário.`;
  }
  for (const anexo of anexos) {
    const limite = ehPdf(anexo) ? LIMITES.pdfBytes : LIMITES.imagemBytes;
    if (anexo.size > limite) return `${anexo.name} passa de ${limite / MB} MB.`;
  }
  return undefined;
}

// Ex.: "820 B", "12 KB", "3,4 MB".
export function formatarTamanho(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < MB) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / MB).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} MB`;
}
