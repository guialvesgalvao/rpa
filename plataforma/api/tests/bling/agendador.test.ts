import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ATRASO_PRIMEIRO_CICLO_MS,
  criarAgendadorBling,
  escolherModo,
} from '../../src/bling/agendador.js';
import type { ArmazemSincronizacao } from '../../src/bling/armazem.js';
import { ErroBlingIndisponivel } from '../../src/bling/cliente.js';
import { criarEstadoSincronizacao } from '../../src/bling/estado.js';
import {
  criarExecucaoSincronizacao,
  type ExecutarSincronizacao,
} from '../../src/bling/execucao.js';
import { ErroBlingNaoConectado } from '../../src/bling/oauth.js';
import { empresas } from '../../src/db/esquema.js';
import { criarRelogioFalso } from '../helpers/app.js';
import { criarBancoTeste, limparTabelas } from '../helpers/banco.js';
import { temporizadorFalso } from '../helpers/temporizador.js';

const { db, fechar } = criarBancoTeste();
afterAll(() => fechar());

const MINUTO = 60 * 1000;
const DIA = 24 * 60 * MINUTO;
const CONFIG = { ligada: true, intervaloMinutos: 15, completaDias: 3 };

let relogio: ReturnType<typeof criarRelogioFalso>;
let roma: string;
beforeEach(async () => {
  await limparTabelas(db);
  relogio = criarRelogioFalso();
  const [linha] = await db.select().from(empresas).where(eq(empresas.slug, 'roma'));
  roma = linha!.id;
});

function montar({
  sincronizar = vi.fn<ExecutarSincronizacao>(async ({ modo }) => ({
    modo: modo?.tipo ?? 'completa',
    produtos: [],
    clientes: [],
    contatosInativos: [],
    avisos: [],
  })),
  acessoValido = vi.fn(async () => 'acesso-ficticio'),
  lista = ['roma'],
  idDaEmpresa = async (slug: string) => (slug === 'roma' ? roma : null),
}: {
  sincronizar?: ReturnType<typeof vi.fn<ExecutarSincronizacao>>;
  acessoValido?: ReturnType<typeof vi.fn<(empresaId: string) => Promise<string>>>;
  lista?: string[];
  idDaEmpresa?: (slug: string) => Promise<string | null>;
} = {}) {
  const estado = criarEstadoSincronizacao({ db, relogio: relogio.agora });
  const armazem: ArmazemSincronizacao = {
    salvar: async () => ({
      produtos: { inseridos: 1, atualizados: 0, inativados: 0, pulados: {} },
      clientes: { inseridos: 0, atualizados: 2, inativados: 0, pulados: {} },
      avisos: [],
    }),
  };
  const execucao = criarExecucaoSincronizacao({
    sincronizar,
    armazem,
    relogio: relogio.agora,
    aoConcluir: (empresa, resultado) => estado.registrar(empresa.id, resultado),
  });
  const tempo = temporizadorFalso();
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const agendador = criarAgendadorBling({
    empresas: lista,
    idDaEmpresa,
    oauth: { acessoValido },
    execucao,
    estado,
    config: CONFIG,
    relogio: relogio.agora,
    temporizador: tempo.temporizador,
    log,
  });
  // Dispara o ciclo agendado e espera o próximo ser agendado (o ciclo terminou).
  async function rodarCiclo() {
    const antes = tempo.agendados.length;
    tempo.disparar();
    await vi.waitFor(() => expect(tempo.agendados.length).toBe(antes + 1));
  }
  return { agendador, estado, execucao, sincronizar, acessoValido, tempo, log, rodarCiclo };
}

describe('escolherModo', () => {
  const agora = new Date('2026-01-10T12:00:00Z');

  it('completa sem completa anterior ou sem janela', () => {
    expect(escolherModo({ incrementalDesde: null, ultimaCompletaEm: null }, agora, 3)).toEqual({
      tipo: 'completa',
    });
    expect(
      escolherModo({ incrementalDesde: null, ultimaCompletaEm: new Date(agora) }, agora, 3).tipo,
    ).toBe('completa');
  });

  it('incremental desde 10 min antes do último início, até agora', () => {
    const desde = new Date('2026-01-10T11:45:00Z');
    expect(
      escolherModo({ incrementalDesde: desde, ultimaCompletaEm: new Date(desde) }, agora, 3),
    ).toEqual({
      tipo: 'incremental',
      desde: new Date('2026-01-10T11:35:00Z'),
      ate: agora,
    });
  });

  it('completa quando a última tem completaDias ou mais', () => {
    const ultima = new Date(agora.getTime() - 3 * DIA);
    expect(
      escolherModo({ incrementalDesde: ultima, ultimaCompletaEm: ultima }, agora, 3).tipo,
    ).toBe('completa');
    const recente = new Date(agora.getTime() - 3 * DIA + 1000);
    expect(
      escolherModo({ incrementalDesde: recente, ultimaCompletaEm: recente }, agora, 3).tipo,
    ).toBe('incremental');
  });
});

describe('agendador', () => {
  it('primeiro ciclo 1 min depois de iniciar, completo; depois incremental; e completa de novo', async () => {
    const { agendador, tempo, sincronizar, estado, rodarCiclo } = montar();
    agendador.iniciar();
    agendador.iniciar();
    expect(tempo.ativos().map((item) => item.ms)).toEqual([ATRASO_PRIMEIRO_CICLO_MS]);

    relogio.avancar(ATRASO_PRIMEIRO_CICLO_MS);
    const primeiro = relogio.agora();
    await rodarCiclo();
    expect(sincronizar.mock.calls[0]?.[0].modo).toEqual({ tipo: 'completa' });
    expect(tempo.ativos().map((item) => item.ms)).toEqual([15 * MINUTO]);
    expect(await estado.ler(roma)).toMatchObject({
      incrementalDesde: primeiro,
      ultimaCompletaEm: primeiro,
      emExecucaoDesde: null,
      ultimoResultado: { tipo: 'completa', origem: 'agendador', situacao: 'concluida' },
    });

    relogio.avancar(15 * MINUTO);
    const segundo = relogio.agora();
    await rodarCiclo();
    expect(sincronizar.mock.calls[1]?.[0].modo).toEqual({
      tipo: 'incremental',
      desde: new Date(primeiro.getTime() - 10 * MINUTO),
      ate: segundo,
    });
    expect((await estado.ler(roma)).incrementalDesde).toEqual(segundo);

    relogio.avancar(3 * DIA);
    await rodarCiclo();
    expect(sincronizar.mock.calls[2]?.[0].modo).toEqual({ tipo: 'completa' });
    await agendador.parar();
  });

  it('sem conexão: registra nao_conectado, não lê o Bling e loga uma vez só', async () => {
    const acessoValido = vi.fn(async (): Promise<string> => {
      throw new ErroBlingNaoConectado();
    });
    const { agendador, sincronizar, estado, log, rodarCiclo } = montar({ acessoValido });
    agendador.iniciar();

    await rodarCiclo();
    await rodarCiclo();
    expect(sincronizar).not.toHaveBeenCalled();
    expect((await estado.ler(roma)).ultimoResultado).toMatchObject({
      tipo: 'completa',
      origem: 'agendador',
      situacao: 'nao_conectado',
      produtos: 0,
      erro: { codigo: 'bling_nao_conectado' },
    });
    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(log.warn.mock.calls)).toContain('roma');

    // Conexão de volta: sincroniza e loga a conclusão; uma nova queda volta a avisar.
    acessoValido.mockResolvedValue('acesso-ficticio');
    await rodarCiclo();
    expect(sincronizar).toHaveBeenCalledTimes(1);
    expect(log.info).toHaveBeenCalledWith(
      expect.objectContaining({ empresa: 'roma', produtos: 1, clientes: 2 }),
      expect.any(String),
    );
    acessoValido.mockRejectedValue(new ErroBlingNaoConectado());
    await rodarCiclo();
    expect(log.warn).toHaveBeenCalledTimes(2);
    await agendador.parar();
  });

  it('Bling fora do ar ao renovar o acesso: registra falhou e tenta no próximo ciclo', async () => {
    const acessoValido = vi.fn(async (): Promise<string> => {
      throw new ErroBlingIndisponivel('SERVER_ERROR', 500);
    });
    const { agendador, estado, log, rodarCiclo } = montar({ acessoValido });
    agendador.iniciar();
    await rodarCiclo();
    expect((await estado.ler(roma)).ultimoResultado).toMatchObject({
      situacao: 'falhou',
      erro: { codigo: 'bling_indisponivel' },
    });
    expect(log.error).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(log.error.mock.calls)).not.toContain('SERVER_ERROR');
    await agendador.parar();
  });

  it('com o lease tomado por outro ciclo, pula sem liberar o lease alheio', async () => {
    const { agendador, estado, sincronizar, rodarCiclo } = montar();
    expect(await estado.tomarLease(roma, 60 * MINUTO)).toBe(true);
    agendador.iniciar();
    await rodarCiclo();

    expect(sincronizar).not.toHaveBeenCalled();
    expect((await estado.ler(roma)).emExecucaoDesde).not.toBeNull();
    await agendador.parar();
  });

  it('com o botão sincronizando, não dispara um segundo job e libera o lease', async () => {
    let liberar: () => void = () => {};
    const sincronizar = vi.fn<ExecutarSincronizacao>(
      () =>
        new Promise((resolver) => {
          liberar = () =>
            resolver({
              modo: 'completa',
              produtos: [],
              clientes: [],
              contatosInativos: [],
              avisos: [],
            });
        }),
    );
    const { agendador, execucao, estado, rodarCiclo } = montar({ sincronizar });
    execucao.iniciar(
      { id: roma, slug: 'roma' },
      async () => 'acesso-ficticio',
      { tipo: 'completa' },
      'botao',
    );
    agendador.iniciar();
    await rodarCiclo();

    expect(sincronizar).toHaveBeenCalledTimes(1);
    expect((await estado.ler(roma)).emExecucaoDesde).toBeNull();
    liberar();
    await execucao.termino('roma');
    expect((await estado.ler(roma)).ultimoResultado?.origem).toBe('botao');
    await agendador.parar();
  });

  it('um erro numa empresa não para as outras nem o próximo ciclo', async () => {
    const idDaEmpresa = vi.fn(async (slug: string) => {
      if (slug === 'quebrada') throw new Error('falha sintética com detalhe interno');
      return slug === 'roma' ? roma : null;
    });
    const { agendador, sincronizar, log, rodarCiclo } = montar({
      lista: ['quebrada', 'inexistente', 'roma'],
      idDaEmpresa,
    });
    agendador.iniciar();

    await rodarCiclo();
    expect(sincronizar).toHaveBeenCalledTimes(1);
    expect(log.error).toHaveBeenCalledWith(
      { empresa: 'quebrada', erro: 'Error' },
      expect.any(String),
    );
    expect(JSON.stringify(log.error.mock.calls)).not.toContain('detalhe interno');

    await rodarCiclo();
    expect(sincronizar).toHaveBeenCalledTimes(2);
    await agendador.parar();
  });

  it('parar cancela o próximo ciclo e impede um novo iniciar', async () => {
    const { agendador, tempo, sincronizar } = montar();
    agendador.iniciar();
    await agendador.parar();

    expect(tempo.ativos()).toEqual([]);
    agendador.iniciar();
    expect(tempo.ativos()).toEqual([]);
    expect(sincronizar).not.toHaveBeenCalled();
  });

  it('parar durante um ciclo espera o ciclo e não agenda outro', async () => {
    let liberar: () => void = () => {};
    const sincronizar = vi.fn<ExecutarSincronizacao>(
      () =>
        new Promise((resolver) => {
          liberar = () =>
            resolver({
              modo: 'completa',
              produtos: [],
              clientes: [],
              contatosInativos: [],
              avisos: [],
            });
        }),
    );
    const { agendador, tempo, estado } = montar({ sincronizar });
    agendador.iniciar();
    tempo.disparar();
    await vi.waitFor(() => expect(sincronizar).toHaveBeenCalledTimes(1));

    let parou = false;
    const parando = agendador.parar().then(() => (parou = true));
    await new Promise((resolver) => setTimeout(resolver, 20));
    expect(parou).toBe(false);

    liberar();
    await parando;
    expect(tempo.ativos()).toEqual([]);
    expect((await estado.ler(roma)).emExecucaoDesde).toBeNull();
  });
});
