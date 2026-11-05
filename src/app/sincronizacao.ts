import type { ProgressoBlingTela, ResultadoSincronizacaoBling } from './api.js';

/** Texto de status do bloco "Sincronizar dados" durante o job. */
export function textoProgressoBling({ etapa, lidos, total }: ProgressoBlingTela): string {
  if (etapa === 'produtos') return 'Lendo produtos…';
  if (etapa === 'clientes') return 'Lendo clientes…';
  return total === null ? 'Detalhando clientes…' : `Detalhando clientes: ${lidos} de ${total}`;
}

const hora = (iso: string) =>
  new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

const plural = (n: number, singular: string, pluralTexto: string) =>
  `${n} ${n === 1 ? singular : pluralTexto}`;

/** Texto de status ao fim do clique (resumo, autorização aberta ou erro). */
export function textoResultadoBling(resultado: ResultadoSincronizacaoBling): string {
  if (resultado.situacao === 'autorizacao_aberta')
    return 'Autorize o acesso ao Bling no navegador e clique em Sincronizar dados de novo.';
  if (resultado.situacao === 'erro') return resultado.mensagem;
  const { produtos, clientes, concluidaEm, avisos } = resultado.resumo;
  const resumo =
    `${plural(produtos, 'produto', 'produtos')} e ${plural(clientes, 'cliente', 'clientes')} ` +
    `lidos às ${hora(concluidaEm)}.`;
  if (avisos.length === 0) return resumo;
  // Cada detalhe que falhar vira um aviso: mostra só os primeiros.
  const restantes = avisos.length - LIMITE_AVISOS;
  const mais = restantes > 0 ? ` (e mais ${plural(restantes, 'aviso', 'avisos')})` : '';
  return `${resumo} Avisos: ${avisos.slice(0, LIMITE_AVISOS).join(' ')}${mais}`;
}

const LIMITE_AVISOS = 3;
