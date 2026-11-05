// As regras de filtro, eventos e status vêm de `contratos` (as mesmas do site).
export { acaoDoStatus, descreverEvento, filtrosDeTarefas } from '../plataforma/contratos.js';

const doisDigitos = (n: number) => String(n).padStart(2, '0');

/** Ex.: "05/11/2026 14:32" (hora local). */
export function formatarDataHora(iso: string): string {
  const d = new Date(iso);
  return `${doisDigitos(d.getDate())}/${doisDigitos(d.getMonth() + 1)}/${d.getFullYear()} ${doisDigitos(d.getHours())}:${doisDigitos(d.getMinutes())}`;
}
