// As regras de filtro, eventos e status vêm de `contratos` (as mesmas do site).
export { acaoDoStatus, descreverEvento, filtrosDeTarefas } from '../plataforma/contratos.js';

const doisDigitos = (n: number) => String(n).padStart(2, '0');

/** Ex.: "05/11/2026 14:32" (hora local). */
export function formatarDataHora(iso: string): string {
  const d = new Date(iso);
  return `${doisDigitos(d.getDate())}/${doisDigitos(d.getMonth() + 1)}/${d.getFullYear()} ${doisDigitos(d.getHours())}:${doisDigitos(d.getMinutes())}`;
}

const MB = 1024 * 1024;

/** Ex.: "820 B", "12 KB", "3,4 MB". */
export function formatarTamanho(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < MB) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / MB).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} MB`;
}
