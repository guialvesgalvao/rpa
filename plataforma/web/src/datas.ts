// As páginas são renderizadas no servidor (UTC no Railway): a hora sai no fuso da fábrica.
const FORMATO_DATA_HORA = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

// Ex.: "05/11/2026 14:32".
export const formatarDataHora = (iso: string): string =>
  FORMATO_DATA_HORA.format(new Date(iso)).replace(',', '');
