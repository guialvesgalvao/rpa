import type { EstadoSincronizacaoBling } from '@plataforma/contratos';

import type { ArmazemSincronizacao } from './armazem.js';
import { type AcessoBling, ErroBling, ErroBlingNaoAutorizado } from './cliente.js';
import { ErroBlingNaoConectado } from './oauth.js';
import type { DadosSincronizacao, OpcoesSincronizacao } from './sincronizacao.js';

export type ExecutarSincronizacao = (opcoes: OpcoesSincronizacao) => Promise<DadosSincronizacao>;

export type ExecucaoSincronizacao = {
  // Com um job da empresa em andamento, devolve o estado dele sem iniciar outro.
  iniciar(empresa: string, acesso: AcessoBling): EstadoSincronizacaoBling;
  estado(empresa: string): EstadoSincronizacaoBling;
  // Aborta os jobs em andamento e espera terminarem (fechamento da API).
  encerrar(): Promise<void>;
};

type ErroEstado = { codigo: string; mensagem: string };

// Códigos públicos, sem detalhes do Bling.
export function erroDaSincronizacao(erro: unknown): ErroEstado {
  if (erro instanceof ErroBlingNaoConectado || erro instanceof ErroBlingNaoAutorizado)
    return {
      codigo: 'bling_nao_conectado',
      mensagem:
        'A conexão com o Bling não vale mais. Clique em Sincronizar dados para autorizar de novo.',
    };
  if (erro instanceof ErroBling)
    return {
      codigo: 'bling_indisponivel',
      mensagem: 'O Bling não respondeu como esperado. Tente de novo em alguns minutos.',
    };
  return { codigo: 'erro_interno', mensagem: 'Erro interno na sincronização.' };
}

type Job = { controle: AbortController; termino?: Promise<void> };

// Um job por empresa, com o estado em memória (a API tem uma réplica, ADR 0003).
export function criarExecucaoSincronizacao({
  sincronizar,
  armazem,
  relogio = () => new Date(),
  aoFalhar = () => {},
}: {
  sincronizar: ExecutarSincronizacao;
  armazem: ArmazemSincronizacao;
  relogio?: () => Date;
  // Só para erros inesperados (`erro_interno`); nunca recebe tokens nem dados do Bling.
  aoFalhar?: (erro: unknown) => void;
}): ExecucaoSincronizacao {
  const estados = new Map<string, EstadoSincronizacaoBling>();
  const jobs = new Map<string, Job>();

  async function rodar(
    empresa: string,
    iniciadaEm: string,
    acesso: AcessoBling,
    controle: AbortController,
  ): Promise<void> {
    const sinal = controle.signal;
    try {
      const dados = await sincronizar({
        acesso,
        sinal,
        aoProgredir: ({ etapa, lidos, total }) =>
          estados.set(empresa, { situacao: 'em_andamento', iniciadaEm, etapa, lidos, total }),
      });
      sinal.throwIfAborted();
      const concluida = relogio();
      await armazem.salvar(empresa, dados, concluida);
      estados.set(empresa, {
        situacao: 'concluida',
        resumo: {
          empresa,
          iniciadaEm,
          concluidaEm: concluida.toISOString(),
          produtos: dados.produtos.length,
          clientes: dados.clientes.length,
          avisos: dados.avisos,
        },
      });
    } catch (erro) {
      const estadoErro = erroDaSincronizacao(erro);
      if (estadoErro.codigo === 'erro_interno' && !sinal.aborted) aoFalhar(erro);
      estados.set(empresa, {
        situacao: 'falhou',
        iniciadaEm,
        concluidaEm: relogio().toISOString(),
        erro: estadoErro,
      });
    } finally {
      if (jobs.get(empresa)?.controle === controle) jobs.delete(empresa);
    }
  }

  function estado(empresa: string): EstadoSincronizacaoBling {
    return estados.get(empresa) ?? { situacao: 'ociosa' };
  }

  return {
    estado,

    iniciar(empresa, acesso) {
      if (jobs.has(empresa)) return estado(empresa);
      const iniciadaEm = relogio().toISOString();
      const controle = new AbortController();
      estados.set(empresa, {
        situacao: 'em_andamento',
        iniciadaEm,
        etapa: 'produtos',
        lidos: 0,
        total: null,
      });
      // O job entra no mapa antes de rodar: uma falha síncrona também o tira de lá no `finally`.
      const job: Job = { controle };
      jobs.set(empresa, job);
      // Sem `await`: `rodar` nunca rejeita (o `catch` registra a falha no estado).
      job.termino = rodar(empresa, iniciadaEm, acesso, controle);
      return estado(empresa);
    },

    async encerrar() {
      const emAndamento = [...jobs.values()];
      for (const job of emAndamento) job.controle.abort();
      await Promise.all(emAndamento.map((job) => job.termino));
    },
  };
}
