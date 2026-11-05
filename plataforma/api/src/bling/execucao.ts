import type { EstadoSincronizacaoBling, ResultadoSincronizacaoBling } from '@plataforma/contratos';

import type { ArmazemSincronizacao } from './armazem.js';
import { type AcessoBling, ErroBling, ErroBlingNaoAutorizado } from './cliente.js';
import { ErroBlingNaoConectado } from './oauth.js';
import type {
  DadosSincronizacao,
  ModoSincronizacao,
  OpcoesSincronizacao,
} from './sincronizacao.js';

export type ExecutarSincronizacao = (opcoes: OpcoesSincronizacao) => Promise<DadosSincronizacao>;

// O estado em memória é por slug; o armazém grava pelo id.
export type EmpresaSincronizacao = { id: string; slug: string };

export type OrigemSincronizacao = ResultadoSincronizacaoBling['origem'];

export type ExecucaoSincronizacao = {
  // Com um job da empresa em andamento, devolve o estado dele sem iniciar outro.
  iniciar(
    empresa: EmpresaSincronizacao,
    acesso: AcessoBling,
    modo: ModoSincronizacao,
    origem: OrigemSincronizacao,
  ): EstadoSincronizacaoBling;
  estado(empresaSlug: string): EstadoSincronizacaoBling;
  // Promessa do job em andamento da empresa (resolve depois do `aoConcluir`); `undefined` sem job.
  termino(empresaSlug: string): Promise<void> | undefined;
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
  aoConcluir = async () => {},
}: {
  sincronizar: ExecutarSincronizacao;
  armazem: ArmazemSincronizacao;
  relogio?: () => Date;
  // Só para erros inesperados (`erro_interno`, ou falha do `aoConcluir`); nunca recebe tokens nem dados do Bling.
  aoFalhar?: (erro: unknown) => void;
  // Fim do job, com sucesso ou falha (nunca no aborto do fechamento da API): grava o resultado no banco.
  aoConcluir?: (
    empresa: EmpresaSincronizacao,
    resultado: ResultadoSincronizacaoBling,
  ) => Promise<void>;
}): ExecucaoSincronizacao {
  const estados = new Map<string, EstadoSincronizacaoBling>();
  const jobs = new Map<string, Job>();

  async function rodar(
    empresaAlvo: EmpresaSincronizacao,
    iniciadaEm: string,
    acesso: AcessoBling,
    modo: ModoSincronizacao,
    origem: OrigemSincronizacao,
    controle: AbortController,
  ): Promise<void> {
    const { id: empresaId, slug: empresa } = empresaAlvo;
    const sinal = controle.signal;
    let resultado: ResultadoSincronizacaoBling | undefined;
    try {
      const dados = await sincronizar({
        acesso,
        modo,
        sinal,
        aoProgredir: ({ etapa, lidos, total }) =>
          estados.set(empresa, { situacao: 'em_andamento', iniciadaEm, etapa, lidos, total }),
      });
      sinal.throwIfAborted();
      const gravado = await armazem.salvar(empresaId, dados, { modo: dados.modo });
      // Contagens do que foi gravado (inseridos + atualizados), não do que foi lido.
      const resumo = {
        empresa,
        iniciadaEm,
        concluidaEm: relogio().toISOString(),
        produtos: gravado.produtos.inseridos + gravado.produtos.atualizados,
        clientes: gravado.clientes.inseridos + gravado.clientes.atualizados,
        avisos: [...dados.avisos, ...gravado.avisos],
      };
      estados.set(empresa, { situacao: 'concluida', resumo });
      resultado = {
        tipo: dados.modo,
        origem,
        situacao: 'concluida',
        iniciadaEm,
        concluidaEm: resumo.concluidaEm,
        produtos: resumo.produtos,
        clientes: resumo.clientes,
        avisos: resumo.avisos,
      };
    } catch (erro) {
      const estadoErro = erroDaSincronizacao(erro);
      if (estadoErro.codigo === 'erro_interno' && !sinal.aborted) aoFalhar(erro);
      const concluidaEm = relogio().toISOString();
      estados.set(empresa, { situacao: 'falhou', iniciadaEm, concluidaEm, erro: estadoErro });
      if (!sinal.aborted)
        resultado = {
          tipo: modo.tipo,
          origem,
          situacao: estadoErro.codigo === 'bling_nao_conectado' ? 'nao_conectado' : 'falhou',
          iniciadaEm,
          concluidaEm,
          produtos: 0,
          clientes: 0,
          avisos: [],
          erro: estadoErro,
        };
    }
    try {
      if (resultado) await aoConcluir(empresaAlvo, resultado);
    } catch (erro) {
      aoFalhar(erro);
    } finally {
      if (jobs.get(empresa)?.controle === controle) jobs.delete(empresa);
    }
  }

  function estado(empresaSlug: string): EstadoSincronizacaoBling {
    return estados.get(empresaSlug) ?? { situacao: 'ociosa' };
  }

  return {
    estado,

    termino: (empresaSlug) => jobs.get(empresaSlug)?.termino,

    iniciar(empresa, acesso, modo, origem) {
      const { slug } = empresa;
      if (jobs.has(slug)) return estado(slug);
      const iniciadaEm = relogio().toISOString();
      const controle = new AbortController();
      estados.set(slug, {
        situacao: 'em_andamento',
        iniciadaEm,
        etapa: 'produtos',
        lidos: 0,
        total: null,
      });
      // O job entra no mapa antes de rodar: uma falha síncrona também o tira de lá no `finally`.
      const job: Job = { controle };
      jobs.set(slug, job);
      // Sem `await`: `rodar` nunca rejeita (o `catch` registra a falha no estado).
      job.termino = rodar(empresa, iniciadaEm, acesso, modo, origem, controle);
      return estado(slug);
    },

    async encerrar() {
      const emAndamento = [...jobs.values()];
      for (const job of emAndamento) job.controle.abort();
      await Promise.all(emAndamento.map((job) => job.termino));
    },
  };
}
