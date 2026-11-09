import { describe, expect, it, vi } from 'vitest';

import { ErroRequisicao } from '../../../src/app/plataforma/artes.js';
import {
  acompanharSincronizacao,
  criarClienteBling,
  urlAutorizacaoSegura,
} from '../../../src/app/plataforma/bling.js';
import { ErroIndisponivel, ErroRecusado } from '../../../src/app/plataforma/cliente.js';
import type { EstadoSincronizacaoBling } from '../../../src/app/plataforma/contratos.js';

// Só dados fictícios.
type Chamada = { url: string; init: RequestInit };

function fetchFalso(responder: (chamada: Chamada) => Response | Promise<Response>) {
  const chamadas: Chamada[] = [];
  const fake = (async (url: string | URL | Request, init?: RequestInit) => {
    const chamada = { url: String(url), init: init ?? {} };
    chamadas.push(chamada);
    return responder(chamada);
  }) as typeof fetch;
  return { fake, chamadas };
}

const json = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { 'content-type': 'application/json' } });
const erro = (status: number, codigo: string, mensagem = 'Mensagem fictícia.') =>
  json({ erro: { codigo, mensagem } }, status);

const INICIADA = '2026-11-04T12:00:00.000Z';
const EM_ANDAMENTO: EstadoSincronizacaoBling = {
  situacao: 'em_andamento',
  iniciadaEm: INICIADA,
  etapa: 'produtos',
  lidos: 0,
  total: null,
};
const RESUMO = {
  empresa: 'roma',
  iniciadaEm: INICIADA,
  concluidaEm: '2026-11-04T12:06:00.000Z',
  produtos: 12,
  clientes: 3,
  avisos: [],
};
const URL_BLING =
  'https://www.bling.com.br/Api/v3/oauth/authorize?response_type=code&client_id=x&state=y';

const montar = (responder: (chamada: Chamada) => Response | Promise<Response>) => {
  const { fake, chamadas } = fetchFalso(responder);
  const cliente = criarClienteBling({
    baseUrl: 'http://api.local/',
    fetch: fake,
    obterAcesso: async () => 'acesso-ficticio',
  });
  return { cliente, chamadas };
};

describe('criarClienteBling', () => {
  it('iniciar faz POST na rota da empresa com o token e lê o 202', async () => {
    const { cliente, chamadas } = montar(() => json(EM_ANDAMENTO, 202));

    expect(await cliente.iniciar('roma')).toEqual(EM_ANDAMENTO);
    expect(chamadas[0]?.url).toBe('http://api.local/v1/empresas/roma/bling/sincronizacao');
    expect(chamadas[0]?.init.method).toBe('POST');
    expect(new Headers(chamadas[0]?.init.headers).get('authorization')).toBe(
      'Bearer acesso-ficticio',
    );
  });

  it('estado faz GET e conectar devolve a URL', async () => {
    const estado = montar(() => json({ situacao: 'concluida', resumo: RESUMO }));
    expect(await estado.cliente.estado('roma')).toEqual({ situacao: 'concluida', resumo: RESUMO });
    expect(estado.chamadas[0]?.init.method).toBe('GET');

    const conexao = montar(() => json({ urlAutorizacao: URL_BLING }));
    expect(await conexao.cliente.conectar('roma')).toEqual({ urlAutorizacao: URL_BLING });
    expect(conexao.chamadas[0]?.url).toBe('http://api.local/v1/empresas/roma/bling/conexao');
  });

  it('409 bling_nao_conectado e 503 bling_nao_configurado viram ErroRequisicao com o código', async () => {
    const naoConectado = montar(() => erro(409, 'bling_nao_conectado'));
    await expect(naoConectado.cliente.iniciar('roma')).rejects.toMatchObject({
      name: 'ErroRequisicao',
      status: 409,
      codigo: 'bling_nao_conectado',
    });
    const naoConfigurado = montar(() => erro(503, 'bling_nao_configurado'));
    const recusa = await naoConfigurado.cliente.iniciar('roma').catch((e: unknown) => e);
    expect(recusa).toBeInstanceOf(ErroRequisicao);
    expect(recusa).toMatchObject({ status: 503, codigo: 'bling_nao_configurado' });
  });

  it('403 vira ErroRecusado', async () => {
    const { cliente } = montar(() => erro(403, 'sincronizacao_indisponivel'));
    await expect(cliente.iniciar('aba')).rejects.toBeInstanceOf(ErroRecusado);
  });

  it('rede fora, 5xx genérico e resposta fora do contrato viram ErroIndisponivel', async () => {
    const rede = montar(() => {
      throw new TypeError('fetch failed');
    });
    await expect(rede.cliente.estado('roma')).rejects.toBeInstanceOf(ErroIndisponivel);
    const servidor = montar(() => new Response('falha', { status: 500 }));
    await expect(servidor.cliente.estado('roma')).rejects.toBeInstanceOf(ErroIndisponivel);
    const foraDoContrato = montar(() => json({ situacao: 'pausada' }));
    await expect(foraDoContrato.cliente.estado('roma')).rejects.toBeInstanceOf(ErroIndisponivel);
    const urlInvalida = montar(() => json({ urlAutorizacao: 'não é url' }));
    await expect(urlInvalida.cliente.conectar('roma')).rejects.toBeInstanceOf(ErroIndisponivel);
  });
});

describe('criarClienteBling: automatica', () => {
  const STATUS = {
    ligada: true,
    intervaloMinutos: 15,
    completaDias: 3,
    ultima: {
      tipo: 'incremental',
      origem: 'agendador',
      situacao: 'concluida',
      iniciadaEm: INICIADA,
      concluidaEm: '2026-11-04T12:00:20.000Z',
      produtos: 1,
      clientes: 3,
      avisos: [],
    },
    ultimaCompletaEm: '2026-11-04T10:00:00.000Z',
    proximaCompletaEm: '2026-11-07T10:00:00.000Z',
    // Dados fictícios.
    conta: { nome: 'Conta Fictícia Ltda', cnpj: '12345678000195' },
  };

  it('faz GET na rota do status com o token e valida o contrato', async () => {
    const { cliente, chamadas } = montar(() => json(STATUS));
    expect(await cliente.automatica('roma')).toEqual(STATUS);
    expect(chamadas[0]?.url).toBe(
      'http://api.local/v1/empresas/roma/bling/sincronizacao/automatica',
    );
    expect(chamadas[0]?.init.method).toBe('GET');
    expect(new Headers(chamadas[0]?.init.headers).get('authorization')).toBe(
      'Bearer acesso-ficticio',
    );
  });

  it('503 bling_nao_configurado vira ErroRequisicao com o código', async () => {
    const { cliente } = montar(() => erro(503, 'bling_nao_configurado'));
    const recusa = await cliente.automatica('roma').catch((e: unknown) => e);
    expect(recusa).toBeInstanceOf(ErroRequisicao);
    expect(recusa).toMatchObject({ status: 503, codigo: 'bling_nao_configurado' });
  });

  it('rede fora e resposta fora do contrato viram ErroIndisponivel', async () => {
    const rede = montar(() => {
      throw new TypeError('fetch failed');
    });
    await expect(rede.cliente.automatica('roma')).rejects.toBeInstanceOf(ErroIndisponivel);
    const fora = montar(() => json({ ...STATUS, ligada: 'sim' }));
    await expect(fora.cliente.automatica('roma')).rejects.toBeInstanceOf(ErroIndisponivel);
  });
});

describe('urlAutorizacaoSegura', () => {
  it('aceita a página de autorização do Bling', () => {
    expect(urlAutorizacaoSegura(URL_BLING)).toBe(true);
  });

  it.each([
    ['http:', URL_BLING.replace('https:', 'http:')],
    ['outro host', 'https://www.exemplo.com/Api/v3/oauth/authorize?state=y'],
    ['subdomínio parecido', 'https://www.bling.com.br.exemplo.com/Api/v3/oauth/authorize'],
    ['host sem www', 'https://bling.com.br/Api/v3/oauth/authorize'],
    ['outro caminho', 'https://www.bling.com.br/Api/v3/outra'],
    ['usuário na URL', 'https://x@www.bling.com.br/Api/v3/oauth/authorize'],
    ['porta', 'https://www.bling.com.br:8443/Api/v3/oauth/authorize'],
    ['javascript:', 'javascript:alert(1)'],
    ['file:', 'file:///C:/Windows/System32/calc.exe'],
    ['texto', 'não é url'],
  ])('recusa %s', (_, url) => {
    expect(urlAutorizacaoSegura(url)).toBe(false);
  });
});

describe('acompanharSincronizacao', () => {
  const andamento = (etapa: 'produtos' | 'clientes' | 'detalhes', lidos: number, total: number | null) =>
    ({ ...EM_ANDAMENTO, etapa, lidos, total }) as EstadoSincronizacaoBling;

  it('consulta a cada 2 s até concluída, repassando o progresso', async () => {
    const estados = [andamento('clientes', 50, null), andamento('detalhes', 3, 10), { situacao: 'concluida', resumo: RESUMO }];
    const estado = vi.fn(async () => estados.shift() as EstadoSincronizacaoBling);
    const esperas: number[] = [];
    const progresso: unknown[] = [];

    const fim = await acompanharSincronizacao({
      iniciar: async () => EM_ANDAMENTO,
      estado,
      esperar: async (ms) => void esperas.push(ms),
      aoProgredir: (p) => progresso.push([p.etapa, p.lidos, p.total]),
    });

    expect(fim).toEqual({ situacao: 'concluida', resumo: RESUMO });
    expect(estado).toHaveBeenCalledTimes(3);
    expect(esperas).toEqual([2000, 2000, 2000]);
    expect(progresso).toEqual([
      ['produtos', 0, null],
      ['clientes', 50, null],
      ['detalhes', 3, 10],
    ]);
  });

  it('para em falhou', async () => {
    const falhou: EstadoSincronizacaoBling = {
      situacao: 'falhou',
      iniciadaEm: INICIADA,
      concluidaEm: INICIADA,
      erro: { codigo: 'bling_indisponivel', mensagem: 'O Bling não respondeu.' },
    };
    const fim = await acompanharSincronizacao({
      iniciar: async () => EM_ANDAMENTO,
      estado: async () => falhou,
      esperar: async () => {},
    });
    expect(fim).toMatchObject({ situacao: 'falhou', erro: { codigo: 'bling_indisponivel' } });
  });

  it('job já concluído no iniciar não consulta de novo', async () => {
    const estado = vi.fn();
    const fim = await acompanharSincronizacao({
      iniciar: async () => ({ situacao: 'concluida', resumo: RESUMO }),
      estado,
      esperar: async () => {},
    });
    expect(fim.situacao).toBe('concluida');
    expect(estado).not.toHaveBeenCalled();
  });

  it('ociosa depois de iniciar (API reiniciada) vira falha', async () => {
    const fim = await acompanharSincronizacao({
      iniciar: async () => EM_ANDAMENTO,
      estado: async () => ({ situacao: 'ociosa' }),
      esperar: async () => {},
    });
    expect(fim).toMatchObject({ situacao: 'falhou', erro: { codigo: 'interrompida' } });
  });

  it('desiste no limite de tempo', async () => {
    const estado = vi.fn(async () => EM_ANDAMENTO);
    await expect(
      acompanharSincronizacao({
        iniciar: async () => EM_ANDAMENTO,
        estado,
        esperar: async () => {},
        limiteMs: 10_000,
      }),
    ).rejects.toBeInstanceOf(ErroIndisponivel);
    expect(estado).toHaveBeenCalledTimes(5);
  });

  it('o erro do iniciar (409) passa adiante', async () => {
    const recusa = new ErroRequisicao(409, 'bling_nao_conectado', 'Não conectado.');
    await expect(
      acompanharSincronizacao({
        iniciar: () => Promise.reject(recusa),
        estado: vi.fn(),
        esperar: async () => {},
      }),
    ).rejects.toBe(recusa);
  });
});
