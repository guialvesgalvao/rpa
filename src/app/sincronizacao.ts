import type { ProgressoBlingTela, ResultadoSincronizacaoBling } from './api.js';
import { formatarCnpj } from './artes/dom.js';
import type { ContaBling, SincronizacaoAutomaticaBling } from './plataforma/contratos.js';

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
  // O servidor conta as linhas gravadas (novas ou que mudaram), não as lidas.
  const resumo =
    `${plural(produtos, 'produto', 'produtos')} e ${plural(clientes, 'cliente', 'clientes')} ` +
    `atualizados às ${hora(concluidaEm)}.`;
  return `${resumo}${textoAvisos(avisos)}`;
}

const LIMITE_AVISOS = 3;

// Só os primeiros avisos, com a contagem do resto.
function textoAvisos(avisos: string[]): string {
  if (avisos.length === 0) return '';
  const restantes = avisos.length - LIMITE_AVISOS;
  const mais = restantes > 0 ? ` (e mais ${plural(restantes, 'aviso', 'avisos')})` : '';
  return ` Avisos: ${avisos.slice(0, LIMITE_AVISOS).join(' ')}${mais}`;
}

const mesmoDia = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();

const diaMes = (data: Date) =>
  data.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });

// "14:30" no mesmo dia; "04/11 às 14:30" em outro.
function quando(iso: string, agora: Date): string {
  const data = new Date(iso);
  return mesmoDia(data, agora) ? hora(iso) : `${diaMes(data)} às ${hora(iso)}`;
}

const semPontoFinal = (texto: string) => texto.trim().replace(/\.+$/, '');

/** Linha do bloco "Sincronizar dados" com a conta do Bling conectada à empresa. */
export function textoContaBling(conta: ContaBling | null): string {
  if (!conta) return 'Conta do Bling não identificada.';
  return `Conectado a: ${conta.nome || 'conta sem nome'} (${formatarCnpj(conta.cnpj)}).`;
}

/** Segunda linha do bloco "Sincronizar dados": a sincronização automática no servidor. */
export function textoAutomaticaBling(status: SincronizacaoAutomaticaBling, agora: Date): string {
  if (!status.ligada) return 'Sincronização automática desligada no servidor.';
  const partes = [`Automática a cada ${status.intervaloMinutos} min.`];
  const ultima = status.ultima;
  if (!ultima) partes.push('Ainda não rodou.');
  else if (ultima.situacao === 'nao_conectado')
    partes.push('Bling não conectado: clique em Sincronizar dados para autorizar.');
  else {
    const origem = ultima.origem === 'botao' ? ', pelo botão' : '';
    const momento = quando(ultima.concluidaEm, agora);
    if (ultima.situacao === 'falhou')
      partes.push(
        `Última falhou às ${momento} (${ultima.tipo}${origem}): ` +
          `${semPontoFinal(ultima.erro?.mensagem ?? 'erro desconhecido')}.`,
      );
    else
      partes.push(
        `Última: ${momento} (${ultima.tipo}${origem}), ` +
          `${plural(ultima.clientes, 'cliente', 'clientes')} e ` +
          `${plural(ultima.produtos, 'produto', 'produtos')} atualizados.${textoAvisos(ultima.avisos)}`,
      );
  }
  if (status.proximaCompletaEm) {
    const proxima = new Date(status.proximaCompletaEm);
    partes.push(`Próxima completa em ${diaMes(proxima)} às ${hora(status.proximaCompletaEm)}.`);
  }
  return partes.join(' ');
}
