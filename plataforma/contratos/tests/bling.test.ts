import { describe, expect, it } from 'vitest';

import {
  EMPRESAS_SINCRONIZACAO_BLING,
  EsquemaConexaoBling,
  EsquemaEstadoSincronizacaoBling,
  EsquemaResultadoSincronizacaoBling,
  EsquemaResumoSincronizacaoBling,
  EsquemaSincronizacaoAutomaticaBling,
  podeSincronizarBling,
} from '../src/index.ts';

describe('podeSincronizarBling', () => {
  it('libera o admin da Roma', () => {
    expect(EMPRESAS_SINCRONIZACAO_BLING).toEqual(['roma']);
    expect(podeSincronizarBling('admin', 'roma')).toBe(true);
  });

  it('recusa a arte finalista, mesmo na Roma', () => {
    expect(podeSincronizarBling('arte_finalista', 'roma')).toBe(false);
  });

  it('recusa empresas fora da lista, slug com outra caixa e empresa ausente', () => {
    expect(podeSincronizarBling('admin', 'aba')).toBe(false);
    expect(podeSincronizarBling('admin', 'ROMA')).toBe(false);
    expect(podeSincronizarBling('admin', ' roma')).toBe(false);
    expect(podeSincronizarBling('admin', '')).toBe(false);
    expect(podeSincronizarBling('admin', undefined)).toBe(false);
  });
});

describe('EsquemaConexaoBling', () => {
  it('aceita a URL de autorização', () => {
    const url =
      'https://www.bling.com.br/Api/v3/oauth/authorize?response_type=code&client_id=x&state=y';
    expect(EsquemaConexaoBling.parse({ urlAutorizacao: url })).toEqual({ urlAutorizacao: url });
  });

  it('recusa texto que não é URL e resposta sem o campo', () => {
    expect(EsquemaConexaoBling.safeParse({ urlAutorizacao: 'não é url' }).success).toBe(false);
    expect(EsquemaConexaoBling.safeParse({}).success).toBe(false);
  });
});

const resumo = {
  empresa: 'roma',
  iniciadaEm: '2026-11-04T12:00:00.000Z',
  concluidaEm: '2026-11-04T12:06:00.000Z',
  produtos: 12,
  clientes: 3,
  avisos: ['Tipo de contato "Cliente" não encontrado; lidos todos os contatos ativos.'],
};

describe('EsquemaResumoSincronizacaoBling', () => {
  it('aceita um resumo com contagens e avisos', () => {
    expect(EsquemaResumoSincronizacaoBling.parse(resumo)).toEqual(resumo);
    expect(
      EsquemaResumoSincronizacaoBling.parse({ ...resumo, produtos: 0, clientes: 0, avisos: [] }),
    ).toBeTruthy();
  });

  it('recusa contagem negativa ou fracionária e data fora do ISO', () => {
    expect(EsquemaResumoSincronizacaoBling.safeParse({ ...resumo, produtos: -1 }).success).toBe(
      false,
    );
    expect(EsquemaResumoSincronizacaoBling.safeParse({ ...resumo, clientes: 1.5 }).success).toBe(
      false,
    );
    expect(
      EsquemaResumoSincronizacaoBling.safeParse({ ...resumo, concluidaEm: '04/11/2026' }).success,
    ).toBe(false);
  });
});

describe('EsquemaEstadoSincronizacaoBling', () => {
  const validos = [
    { situacao: 'ociosa' },
    {
      situacao: 'em_andamento',
      iniciadaEm: '2026-11-04T12:00:00.000Z',
      etapa: 'produtos',
      lidos: 100,
      total: null,
    },
    {
      situacao: 'em_andamento',
      iniciadaEm: '2026-11-04T12:00:00.000Z',
      etapa: 'detalhes',
      lidos: 120,
      total: 950,
    },
    { situacao: 'concluida', resumo },
    {
      situacao: 'falhou',
      iniciadaEm: '2026-11-04T12:00:00.000Z',
      concluidaEm: '2026-11-04T12:01:00.000Z',
      erro: { codigo: 'bling_indisponivel', mensagem: 'O Bling não respondeu.' },
    },
  ];

  it.each(validos)('aceita $situacao', (estado) => {
    expect(EsquemaEstadoSincronizacaoBling.parse(estado)).toEqual(estado);
  });

  it('recusa situação desconhecida', () => {
    expect(EsquemaEstadoSincronizacaoBling.safeParse({ situacao: 'pausada' }).success).toBe(false);
    expect(EsquemaEstadoSincronizacaoBling.safeParse({}).success).toBe(false);
  });

  it('recusa etapa desconhecida e progresso inválido', () => {
    const andamento = validos[1]!;
    expect(
      EsquemaEstadoSincronizacaoBling.safeParse({ ...andamento, etapa: 'pedidos' }).success,
    ).toBe(false);
    expect(EsquemaEstadoSincronizacaoBling.safeParse({ ...andamento, lidos: -1 }).success).toBe(
      false,
    );
    expect(
      EsquemaEstadoSincronizacaoBling.safeParse({ ...andamento, total: undefined }).success,
    ).toBe(false);
  });

  it('recusa estados sem os campos da sua situação', () => {
    expect(EsquemaEstadoSincronizacaoBling.safeParse({ situacao: 'concluida' }).success).toBe(
      false,
    );
    expect(
      EsquemaEstadoSincronizacaoBling.safeParse({
        situacao: 'falhou',
        iniciadaEm: '2026-11-04T12:00:00.000Z',
        concluidaEm: '2026-11-04T12:01:00.000Z',
      }).success,
    ).toBe(false);
  });
});

const resultado = {
  tipo: 'incremental',
  origem: 'agendador',
  situacao: 'concluida',
  iniciadaEm: '2026-11-05T12:00:00.000Z',
  concluidaEm: '2026-11-05T12:00:20.000Z',
  produtos: 1,
  clientes: 3,
  avisos: ['1 cliente sem CNPJ válido ficou de fora.'],
};

describe('EsquemaResultadoSincronizacaoBling', () => {
  it('aceita sucesso, falha com erro e não conectado', () => {
    expect(EsquemaResultadoSincronizacaoBling.parse(resultado)).toEqual(resultado);
    const falha = {
      ...resultado,
      tipo: 'completa',
      origem: 'botao',
      situacao: 'falhou',
      produtos: 0,
      clientes: 0,
      avisos: [],
      erro: { codigo: 'bling_indisponivel', mensagem: 'O Bling não respondeu.' },
    };
    expect(EsquemaResultadoSincronizacaoBling.parse(falha)).toEqual(falha);
    expect(
      EsquemaResultadoSincronizacaoBling.safeParse({ ...resultado, situacao: 'nao_conectado' })
        .success,
    ).toBe(true);
  });

  it('recusa tipo, origem e situação desconhecidos, contagem inválida e data fora do ISO', () => {
    for (const invalido of [
      { tipo: 'parcial' },
      { origem: 'cli' },
      { situacao: 'em_andamento' },
      { produtos: -1 },
      { clientes: 0.5 },
      { iniciadaEm: '05/11/2026' },
      { erro: { codigo: 'x' } },
    ])
      expect(
        EsquemaResultadoSincronizacaoBling.safeParse({ ...resultado, ...invalido }).success,
      ).toBe(false);
  });
});

describe('EsquemaSincronizacaoAutomaticaBling', () => {
  const status = {
    ligada: true,
    intervaloMinutos: 15,
    completaDias: 3,
    ultima: resultado,
    ultimaCompletaEm: '2026-11-04T10:00:00.000Z',
    proximaCompletaEm: '2026-11-07T10:00:00.000Z',
  };

  it('aceita o status com e sem sincronização anterior', () => {
    expect(EsquemaSincronizacaoAutomaticaBling.parse(status)).toEqual(status);
    const nunca = {
      ...status,
      ligada: false,
      ultima: null,
      ultimaCompletaEm: null,
      proximaCompletaEm: null,
    };
    expect(EsquemaSincronizacaoAutomaticaBling.parse(nunca)).toEqual(nunca);
  });

  it('recusa campos ausentes, intervalo zero e resultado fora do contrato', () => {
    expect(
      EsquemaSincronizacaoAutomaticaBling.safeParse({ ...status, ligada: 'sim' }).success,
    ).toBe(false);
    expect(
      EsquemaSincronizacaoAutomaticaBling.safeParse({ ...status, intervaloMinutos: 0 }).success,
    ).toBe(false);
    expect(
      EsquemaSincronizacaoAutomaticaBling.safeParse({
        ...status,
        ultima: { ...resultado, situacao: 'x' },
      }).success,
    ).toBe(false);
    const semProxima: Partial<typeof status> = { ...status };
    delete semProxima.proximaCompletaEm;
    expect(EsquemaSincronizacaoAutomaticaBling.safeParse(semProxima).success).toBe(false);
  });
});
