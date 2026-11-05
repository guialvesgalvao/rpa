import type { ResultadoSincronizacaoBling } from '@plataforma/contratos';

import type { ConfigSincronizacaoAutomatica } from '../config.js';
import type { EstadoSalvoSincronizacao, EstadoSincronizacao } from './estado.js';
import { erroDaSincronizacao, type ExecucaoSincronizacao } from './execucao.js';
import type { OAuthBling } from './oauth.js';
import type { ModoSincronizacao } from './sincronizacao.js';

const MINUTO_MS = 60 * 1000;
const DIA_MS = 24 * 60 * MINUTO_MS;
// Primeiro ciclo depois de a API ficar pronta.
export const ATRASO_PRIMEIRO_CICLO_MS = MINUTO_MS;
// Margem no início da janela do incremental (relógios e fuso do Bling).
export const MARGEM_INCREMENTAL_MS = 10 * MINUTO_MS;
// Um lease mais velho que isto é de um ciclo que morreu sem liberar (deploy no meio, por exemplo).
export const VALIDADE_LEASE_MS = 60 * MINUTO_MS;

// `agendar` devolve a função que cancela; os testes injetam um temporizador falso.
export type Temporizador = { agendar(fn: () => void, ms: number): () => void };

export const temporizadorReal: Temporizador = {
  agendar(fn, ms) {
    const id = setTimeout(fn, ms);
    return () => clearTimeout(id);
  },
};

export type LogAgendador = {
  info(dados: object, mensagem: string): void;
  warn(dados: object, mensagem: string): void;
  error(dados: object, mensagem: string): void;
};

export type AgendadorBling = {
  iniciar(): void;
  // Cancela o próximo ciclo e espera o atual terminar (o fechamento da API aborta o job antes de esperar).
  parar(): Promise<void>;
};

// Completa se nunca houve uma, ou se a última tem `completaDias` ou mais; senão, incremental desde o início do
// último ciclo bem-sucedido, com margem.
export function escolherModo(
  salvo: Pick<EstadoSalvoSincronizacao, 'incrementalDesde' | 'ultimaCompletaEm'>,
  agora: Date,
  completaDias: number,
): ModoSincronizacao {
  const { incrementalDesde, ultimaCompletaEm } = salvo;
  if (
    !incrementalDesde ||
    !ultimaCompletaEm ||
    agora.getTime() - ultimaCompletaEm.getTime() >= completaDias * DIA_MS
  )
    return { tipo: 'completa' };
  return {
    tipo: 'incremental',
    desde: new Date(incrementalDesde.getTime() - MARGEM_INCREMENTAL_MS),
    ate: agora,
  };
}

const nomeDoErro = (erro: unknown) => (erro instanceof Error ? erro.name : 'desconhecido');

// Sincronização automática dentro da API: um ciclo por vez, o próximo `intervaloMinutos` depois do fim do
// anterior. Usa o mesmo job do botão (nunca dois por empresa) e um lease no banco contra ciclos duplicados.
export function criarAgendadorBling({
  empresas,
  idDaEmpresa,
  oauth,
  execucao,
  estado,
  config,
  relogio = () => new Date(),
  temporizador = temporizadorReal,
  log,
}: {
  empresas: readonly string[];
  idDaEmpresa: (slug: string) => Promise<string | null>;
  oauth: Pick<OAuthBling, 'acessoValido'>;
  execucao: Pick<ExecucaoSincronizacao, 'iniciar' | 'termino'>;
  estado: EstadoSincronizacao;
  config: ConfigSincronizacaoAutomatica;
  relogio?: () => Date;
  temporizador?: Temporizador;
  log: LogAgendador;
}): AgendadorBling {
  let iniciado = false;
  let parado = false;
  let cancelar: (() => void) | undefined;
  let cicloAtual: Promise<void> | undefined;
  // Última situação logada por empresa: `nao_conectado` sai no log uma vez, não a cada ciclo.
  const situacoes = new Map<string, ResultadoSincronizacaoBling['situacao']>();

  function logarResultado(slug: string, resultado: ResultadoSincronizacaoBling | null) {
    if (!resultado) return;
    const anterior = situacoes.get(slug);
    situacoes.set(slug, resultado.situacao);
    if (resultado.situacao === 'nao_conectado') {
      if (anterior !== 'nao_conectado')
        log.warn(
          { empresa: slug },
          'Sincronização automática do Bling sem conexão: autorize de novo pelo app',
        );
      return;
    }
    // Só contagens e códigos: nada de tokens nem dados do Bling.
    if (resultado.situacao === 'falhou')
      log.error(
        { empresa: slug, tipo: resultado.tipo, codigo: resultado.erro?.codigo },
        'Sincronização automática do Bling falhou',
      );
    else
      log.info(
        {
          empresa: slug,
          tipo: resultado.tipo,
          produtos: resultado.produtos,
          clientes: resultado.clientes,
          avisos: resultado.avisos.length,
        },
        'Sincronização automática do Bling concluída',
      );
  }

  async function sincronizarEmpresa(slug: string): Promise<void> {
    const empresaId = await idDaEmpresa(slug);
    if (!empresaId) return;
    const empresa = { id: empresaId, slug };
    // Outro ciclo (outra réplica) com a empresa: pula.
    if (!(await estado.tomarLease(empresaId, VALIDADE_LEASE_MS))) return;
    try {
      // O botão já está sincronizando: pula, sem um segundo job.
      if (execucao.termino(slug)) return;
      const agora = relogio();
      const modo = escolherModo(await estado.ler(empresaId), agora, config.completaDias);

      try {
        await oauth.acessoValido(empresaId);
      } catch (erro) {
        const motivo = erroDaSincronizacao(erro);
        const resultado: ResultadoSincronizacaoBling = {
          tipo: modo.tipo,
          origem: 'agendador',
          situacao: motivo.codigo === 'bling_nao_conectado' ? 'nao_conectado' : 'falhou',
          iniciadaEm: agora.toISOString(),
          concluidaEm: relogio().toISOString(),
          produtos: 0,
          clientes: 0,
          avisos: [],
          erro: motivo,
        };
        await estado.registrar(empresaId, resultado);
        logarResultado(slug, resultado);
        return;
      }

      // Sem `await` entre esta checagem e o `iniciar`: depois de `parar`, nenhum job novo começa.
      if (parado) return;
      execucao.iniciar(empresa, () => oauth.acessoValido(empresaId), modo, 'agendador');
      await execucao.termino(slug);
      if (!parado) logarResultado(slug, (await estado.ler(empresaId)).ultimoResultado);
    } finally {
      await estado.liberarLease(empresaId);
    }
  }

  async function ciclo(): Promise<void> {
    for (const slug of empresas) {
      if (parado) return;
      try {
        await sincronizarEmpresa(slug);
      } catch (erro) {
        // Uma empresa com erro não para as outras nem o agendador.
        log.error(
          { empresa: slug, erro: nomeDoErro(erro) },
          'Falha no ciclo da sincronização automática do Bling',
        );
      }
    }
  }

  function agendar(ms: number) {
    cancelar = temporizador.agendar(() => {
      cancelar = undefined;
      cicloAtual = ciclo().finally(() => {
        cicloAtual = undefined;
        if (!parado) agendar(config.intervaloMinutos * MINUTO_MS);
      });
    }, ms);
  }

  return {
    iniciar() {
      if (iniciado || parado) return;
      iniciado = true;
      log.info(
        { intervaloMinutos: config.intervaloMinutos, completaDias: config.completaDias },
        'Sincronização automática do Bling ligada',
      );
      agendar(ATRASO_PRIMEIRO_CICLO_MS);
    },

    async parar() {
      parado = true;
      cancelar?.();
      cancelar = undefined;
      await cicloAtual;
    },
  };
}
