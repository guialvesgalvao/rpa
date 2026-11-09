// Os filtros de data da API v3 do Bling (`dataAlteracaoInicial` etc.) usam o horário de Brasília (hipótese do
// plano, com margem na janela do incremental).
const FUSO_BLING = 'America/Sao_Paulo';

const FORMATO = new Intl.DateTimeFormat('en-US', {
  timeZone: FUSO_BLING,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

// `AAAA-MM-DD HH:MM:SS` em `America/Sao_Paulo`.
export function formatarDataHoraBling(instante: Date): string {
  const partes = Object.fromEntries(
    FORMATO.formatToParts(instante).map((parte) => [parte.type, parte.value]),
  );
  return `${partes.year}-${partes.month}-${partes.day} ${partes.hour}:${partes.minute}:${partes.second}`;
}

// `AAAA-MM-DD` em `America/Sao_Paulo` (filtros só de data, como o `dataInicial` dos pedidos).
export function formatarDataBling(instante: Date): string {
  return formatarDataHoraBling(instante).slice(0, 10);
}
