import type { EstadoSincronizacaoBling } from '@plataforma/contratos';
import { EsquemaEstadoSincronizacaoBling } from '@plataforma/contratos';
import { describe, expect, it, vi } from 'vitest';

import type { ArmazemSincronizacao, ResultadoGravacao } from '../../src/bling/armazem.js';
import { ErroBlingIndisponivel, ErroBlingNaoAutorizado } from '../../src/bling/cliente.js';
import {
  criarExecucaoSincronizacao,
  type ExecutarSincronizacao,
} from '../../src/bling/execucao.js';
import { ErroBlingNaoConectado } from '../../src/bling/oauth.js';
import type { DadosSincronizacao } from '../../src/bling/sincronizacao.js';
import { criarRelogioFalso } from '../helpers/app.js';

// Só dados sintéticos.
const DADOS: DadosSincronizacao = {
  modo: 'completa',
  produtos: [
    { idBling: 1, codigo: 'SKU1', nome: 'Produto 1', formato: 'S', idProdutoPai: null },
    { idBling: 2, codigo: null, nome: 'Produto 2', formato: 'S', idProdutoPai: null },
  ],
  clientes: [
    {
      idBling: 100,
      nome: 'Empresa Fictícia',
      fantasia: null,
      tipoPessoa: 'J',
      documento: '11222333000181',
    },
  ],
  contatosInativos: [],
  avisos: ['aviso sintético'],
};

const acesso = async () => 'acesso-ficticio';
const ROMA = { id: 'id-roma-ficticio', slug: 'roma' };
const OUTRA = { id: 'id-outra-ficticio', slug: 'outra' };
const COMPLETA = { tipo: 'completa' } as const;

// Armazém falso: 2 produtos inseridos, 1 cliente atualizado e um aviso agregado.
const GRAVADO: ResultadoGravacao = {
  produtos: { inseridos: 2, atualizados: 0, inativados: 0, pulados: {} },
  clientes: { inseridos: 0, atualizados: 1, inativados: 3, pulados: { cnpj_invalido: 1 } },
  avisos: ['1 cliente sem CNPJ válido ficou de fora.'],
};
const armazemFalso = () => ({
  salvar: vi.fn<ArmazemSincronizacao['salvar']>().mockResolvedValue(GRAVADO),
});

// Sincronização controlada pelo teste: termina quando `liberar`/`falhar` são chamados ou o sinal aborta.
function sincronizacaoControlada() {
  let liberar: (dados: DadosSincronizacao) => void = () => {};
  let falhar: (erro: unknown) => void = () => {};
  const sincronizar = vi.fn<ExecutarSincronizacao>(
    ({ aoProgredir, sinal }) =>
      new Promise((resolver, rejeitar) => {
        aoProgredir?.({ etapa: 'detalhes', lidos: 3, total: 10 });
        liberar = resolver;
        falhar = rejeitar;
        sinal?.addEventListener('abort', () => rejeitar(sinal.reason));
      }),
  );
  return { sincronizar, liberar: (d = DADOS) => liberar(d), falhar: (e: unknown) => falhar(e) };
}

function montar(
  sincronizar: ExecutarSincronizacao,
  armazem: ReturnType<typeof armazemFalso> = armazemFalso(),
) {
  const relogio = criarRelogioFalso();
  const aoFalhar = vi.fn();
  const aoConcluir = vi.fn(async () => {});
  const execucao = criarExecucaoSincronizacao({
    sincronizar,
    armazem,
    aoConcluir,
    relogio: relogio.agora,
    aoFalhar,
  });
  const situacao = async (empresa: string, esperada: EstadoSincronizacaoBling['situacao']) =>
    vi.waitFor(() => {
      const estado = execucao.estado(empresa);
      expect(estado.situacao).toBe(esperada);
      return EsquemaEstadoSincronizacaoBling.parse(estado);
    });
  return { execucao, relogio, aoFalhar, aoConcluir, situacao, armazem };
}

describe('execução da sincronização', () => {
  it('começa ociosa', () => {
    const { execucao } = montar(vi.fn());
    expect(execucao.estado('roma')).toEqual({ situacao: 'ociosa' });
  });

  it('roda em segundo plano, mostra o progresso e termina concluída com o resumo do que gravou', async () => {
    const controlada = sincronizacaoControlada();
    const { execucao, relogio, situacao, armazem } = montar(controlada.sincronizar);
    const iniciadaEm = relogio.agora().toISOString();

    expect(execucao.iniciar(ROMA, acesso, COMPLETA, 'botao')).toEqual({
      situacao: 'em_andamento',
      iniciadaEm,
      etapa: 'detalhes',
      lidos: 3,
      total: 10,
    });

    relogio.avancar(60_000);
    controlada.liberar();
    expect(await situacao('roma', 'concluida')).toEqual({
      situacao: 'concluida',
      resumo: {
        empresa: 'roma',
        iniciadaEm,
        concluidaEm: relogio.agora().toISOString(),
        produtos: 2,
        clientes: 1,
        avisos: ['aviso sintético', '1 cliente sem CNPJ válido ficou de fora.'],
      },
    });
    expect(armazem.salvar).toHaveBeenCalledExactlyOnceWith(ROMA.id, DADOS, { modo: 'completa' });
  });

  it('um segundo iniciar durante o job devolve o mesmo estado sem nova leitura', async () => {
    const controlada = sincronizacaoControlada();
    const { execucao, relogio, situacao } = montar(controlada.sincronizar);
    const primeiro = execucao.iniciar(ROMA, acesso, COMPLETA, 'botao');
    relogio.avancar(5000);

    expect(execucao.iniciar(ROMA, acesso, COMPLETA, 'botao')).toEqual(primeiro);
    expect(controlada.sincronizar).toHaveBeenCalledTimes(1);

    controlada.liberar();
    await situacao('roma', 'concluida');
    execucao.iniciar(ROMA, acesso, COMPLETA, 'botao');
    expect(controlada.sincronizar).toHaveBeenCalledTimes(2);
  });

  it('repassa o modo à leitura e grava no modo efetivo da leitura', async () => {
    const incremental = {
      tipo: 'incremental',
      desde: new Date('2026-01-05T11:50:00Z'),
      ate: new Date('2026-01-05T12:00:00Z'),
    } as const;
    const sincronizar = vi.fn<ExecutarSincronizacao>(async () => ({
      ...DADOS,
      modo: 'incremental',
      contatosInativos: [7],
    }));
    const { execucao, situacao, armazem } = montar(sincronizar);
    execucao.iniciar(ROMA, acesso, incremental, 'agendador');
    await situacao('roma', 'concluida');

    expect(sincronizar.mock.calls[0]?.[0].modo).toEqual(incremental);
    expect(armazem.salvar).toHaveBeenCalledExactlyOnceWith(
      ROMA.id,
      expect.objectContaining({ contatosInativos: [7] }),
      { modo: 'incremental' },
    );
  });

  it('empresas diferentes têm jobs independentes', () => {
    const controlada = sincronizacaoControlada();
    const { execucao } = montar(controlada.sincronizar);
    execucao.iniciar(ROMA, acesso, COMPLETA, 'botao');
    execucao.iniciar(OUTRA, acesso, COMPLETA, 'botao');
    expect(controlada.sincronizar).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['ErroBlingNaoConectado', new ErroBlingNaoConectado(), 'bling_nao_conectado'],
    ['ErroBlingNaoAutorizado', new ErroBlingNaoAutorizado(), 'bling_nao_conectado'],
    ['ErroBlingIndisponivel', new ErroBlingIndisponivel('SERVER_ERROR', 500), 'bling_indisponivel'],
    ['erro qualquer', new Error('detalhe interno'), 'erro_interno'],
  ])('%s no meio do job → falhou com %s', async (_, erro, codigo) => {
    const controlada = sincronizacaoControlada();
    const { execucao, aoFalhar, situacao, armazem } = montar(controlada.sincronizar);
    execucao.iniciar(ROMA, acesso, COMPLETA, 'botao');
    controlada.falhar(erro);

    const estado = await situacao('roma', 'falhou');
    expect(estado).toMatchObject({ erro: { codigo } });
    expect(JSON.stringify(estado)).not.toMatch(/detalhe interno|SERVER_ERROR/);
    expect(aoFalhar).toHaveBeenCalledTimes(codigo === 'erro_interno' ? 1 : 0);
    expect(armazem.salvar).not.toHaveBeenCalled();
  });

  it('falha síncrona do sincronizar também termina o job', async () => {
    const sincronizar = vi.fn<ExecutarSincronizacao>(() => {
      throw new Error('síncrono');
    });
    const { execucao, situacao } = montar(sincronizar);
    execucao.iniciar(ROMA, acesso, COMPLETA, 'botao');
    await situacao('roma', 'falhou');
    execucao.iniciar(ROMA, acesso, COMPLETA, 'botao');
    expect(sincronizar).toHaveBeenCalledTimes(2);
  });

  it('falha ao gravar no banco → falhou com erro interno', async () => {
    const controlada = sincronizacaoControlada();
    const armazem = armazemFalso();
    armazem.salvar.mockRejectedValue(new Error('banco fora'));
    const { execucao, situacao } = montar(controlada.sincronizar, armazem);
    execucao.iniciar(ROMA, acesso, COMPLETA, 'botao');
    controlada.liberar();
    expect(await situacao('roma', 'falhou')).toMatchObject({ erro: { codigo: 'erro_interno' } });
  });

  it('encerrar aborta os jobs e espera terminarem, sem gravar', async () => {
    const controlada = sincronizacaoControlada();
    const { execucao, aoFalhar, armazem } = montar(controlada.sincronizar);
    execucao.iniciar(ROMA, acesso, COMPLETA, 'botao');

    await execucao.encerrar();

    const sinal = controlada.sincronizar.mock.calls[0]?.[0].sinal;
    expect(sinal?.aborted).toBe(true);
    expect(execucao.estado('roma').situacao).toBe('falhou');
    expect(aoFalhar).not.toHaveBeenCalled();
    expect(armazem.salvar).not.toHaveBeenCalled();
  });

  it('encerrar sem jobs não faz nada', async () => {
    const { execucao } = montar(vi.fn());
    await expect(execucao.encerrar()).resolves.toBeUndefined();
  });

  it('ao concluir, registra o resultado com a origem, o tipo efetivo e as contagens', async () => {
    const controlada = sincronizacaoControlada();
    const { execucao, relogio, aoConcluir, situacao } = montar(controlada.sincronizar);
    const iniciadaEm = relogio.agora().toISOString();
    execucao.iniciar(ROMA, acesso, COMPLETA, 'botao');
    relogio.avancar(30_000);
    controlada.liberar();
    await situacao('roma', 'concluida');

    await vi.waitFor(() => expect(aoConcluir).toHaveBeenCalledTimes(1));
    expect(aoConcluir).toHaveBeenCalledWith(ROMA, {
      tipo: 'completa',
      origem: 'botao',
      situacao: 'concluida',
      iniciadaEm,
      concluidaEm: relogio.agora().toISOString(),
      produtos: 2,
      clientes: 1,
      avisos: ['aviso sintético', '1 cliente sem CNPJ válido ficou de fora.'],
    });
  });

  it.each([
    [new ErroBlingIndisponivel('SERVER_ERROR', 500), 'falhou', 'bling_indisponivel'],
    [new ErroBlingNaoConectado(), 'nao_conectado', 'bling_nao_conectado'],
  ])('na falha, registra %s como %s, sem contagens', async (erro, situacao, codigo) => {
    const controlada = sincronizacaoControlada();
    const montado = montar(controlada.sincronizar);
    const incremental = {
      tipo: 'incremental',
      desde: new Date('2026-01-05T11:00:00Z'),
      ate: new Date('2026-01-05T12:00:00Z'),
    } as const;
    montado.execucao.iniciar(ROMA, acesso, incremental, 'agendador');
    controlada.falhar(erro);
    await montado.situacao('roma', 'falhou');

    await vi.waitFor(() => expect(montado.aoConcluir).toHaveBeenCalledTimes(1));
    expect(montado.aoConcluir).toHaveBeenCalledWith(
      ROMA,
      expect.objectContaining({
        tipo: 'incremental',
        origem: 'agendador',
        situacao,
        produtos: 0,
        clientes: 0,
        avisos: [],
        erro: expect.objectContaining({ codigo }),
      }),
    );
  });

  it('no encerramento da API (aborto) não registra resultado', async () => {
    const controlada = sincronizacaoControlada();
    const { execucao, aoConcluir } = montar(controlada.sincronizar);
    execucao.iniciar(ROMA, acesso, COMPLETA, 'agendador');
    await execucao.encerrar();
    expect(aoConcluir).not.toHaveBeenCalled();
  });

  it('termino resolve depois do aoConcluir; sem job, é undefined', async () => {
    const controlada = sincronizacaoControlada();
    const { execucao, aoConcluir } = montar(controlada.sincronizar);
    expect(execucao.termino('roma')).toBeUndefined();

    let liberarRegistro: () => void = () => {};
    aoConcluir.mockImplementationOnce(
      () => new Promise<void>((resolver) => (liberarRegistro = resolver)),
    );
    execucao.iniciar(ROMA, acesso, COMPLETA, 'agendador');
    const termino = execucao.termino('roma');
    expect(termino).toBeInstanceOf(Promise);

    let terminou = false;
    void termino?.then(() => (terminou = true));
    controlada.liberar();
    await vi.waitFor(() => expect(aoConcluir).toHaveBeenCalledTimes(1));
    await new Promise((resolver) => setTimeout(resolver, 10));
    expect(terminou).toBe(false);

    liberarRegistro();
    await termino;
    expect(execucao.termino('roma')).toBeUndefined();
  });

  it('falha ao registrar o resultado vai para aoFalhar e não trava o job', async () => {
    const controlada = sincronizacaoControlada();
    const { execucao, aoConcluir, aoFalhar } = montar(controlada.sincronizar);
    aoConcluir.mockRejectedValueOnce(new Error('banco fora'));
    execucao.iniciar(ROMA, acesso, COMPLETA, 'botao');
    const termino = execucao.termino('roma');
    controlada.liberar();

    await expect(termino).resolves.toBeUndefined();
    expect(aoFalhar).toHaveBeenCalledTimes(1);
    expect(execucao.estado('roma').situacao).toBe('concluida');
  });

  it('a etapa depois da gravação recebe o modo efetivo: incremental mantido ou virado completa', async () => {
    const aposSalvar = vi.fn(async () => []);
    const incremental = {
      tipo: 'incremental',
      desde: new Date('2026-11-09T10:00:00Z'),
      ate: new Date('2026-11-09T10:15:00Z'),
    } as const;
    for (const lido of ['incremental', 'completa'] as const) {
      const execucao = criarExecucaoSincronizacao({
        sincronizar: async () => ({ ...DADOS, modo: lido }),
        armazem: armazemFalso(),
        aposSalvar,
      });
      execucao.iniciar(ROMA, acesso, incremental, 'agendador');
      await execucao.termino('roma');
    }
    expect(aposSalvar.mock.calls.map((c) => (c as unknown[])[3])).toEqual([incremental, COMPLETA]);
  });

  it('a etapa depois da gravação roda no mesmo job, com o acesso, e os avisos dela vão para o resumo', async () => {
    const aposSalvar = vi.fn(async () => ['1 tarefa(s) de arte criada(s) a partir dos pedidos.']);
    const execucao = criarExecucaoSincronizacao({
      sincronizar: async () => DADOS,
      armazem: armazemFalso(),
      aposSalvar,
    });
    execucao.iniciar(ROMA, acesso, COMPLETA, 'botao');
    await execucao.termino('roma');
    expect(aposSalvar).toHaveBeenCalledWith(ROMA, acesso, expect.any(AbortSignal), COMPLETA);
    const estado = execucao.estado('roma');
    if (estado.situacao !== 'concluida') throw new Error('esperava concluída');
    expect(estado.resumo.avisos).toEqual([
      'aviso sintético',
      '1 cliente sem CNPJ válido ficou de fora.',
      '1 tarefa(s) de arte criada(s) a partir dos pedidos.',
    ]);
  });
});
