import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { EstadoSincronizacaoBling } from '@plataforma/contratos';
import { EsquemaEstadoSincronizacaoBling } from '@plataforma/contratos';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type ArmazemSincronizacao, criarArmazemArquivo } from '../../src/bling/armazem.js';
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
  avisos: ['aviso sintético'],
};

const acesso = async () => 'acesso-ficticio';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'bling-'));
});
afterEach(() => rm(dir, { recursive: true, force: true }));

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

function montar(sincronizar: ExecutarSincronizacao, armazem?: ArmazemSincronizacao) {
  const relogio = criarRelogioFalso();
  const aoFalhar = vi.fn();
  const execucao = criarExecucaoSincronizacao({
    sincronizar,
    armazem: armazem ?? criarArmazemArquivo(dir),
    relogio: relogio.agora,
    aoFalhar,
  });
  const situacao = async (empresa: string, esperada: EstadoSincronizacaoBling['situacao']) =>
    vi.waitFor(() => {
      const estado = execucao.estado(empresa);
      expect(estado.situacao).toBe(esperada);
      return EsquemaEstadoSincronizacaoBling.parse(estado);
    });
  return { execucao, relogio, aoFalhar, situacao };
}

describe('armazém em arquivo', () => {
  it('grava <empresa>.json com as contagens, sem deixar o temporário', async () => {
    const pasta = path.join(dir, 'data', 'bling');
    await criarArmazemArquivo(pasta).salvar('roma', DADOS, new Date('2026-01-05T12:00:00.000Z'));

    const gravado = JSON.parse(await readFile(path.join(pasta, 'roma.json'), 'utf8'));
    expect(gravado).toEqual({
      empresa: 'roma',
      sincronizadoEm: '2026-01-05T12:00:00.000Z',
      ...DADOS,
    });
    expect(await readdir(pasta)).toEqual(['roma.json']);
  });

  it('sobrescreve a sincronização anterior', async () => {
    const armazem = criarArmazemArquivo(dir);
    await armazem.salvar('roma', DADOS, new Date());
    await armazem.salvar('roma', { produtos: [], clientes: [], avisos: [] }, new Date());
    const gravado = JSON.parse(await readFile(path.join(dir, 'roma.json'), 'utf8'));
    expect(gravado.produtos).toEqual([]);
  });

  it('recusa slug que escaparia da pasta', async () => {
    const armazem = criarArmazemArquivo(dir);
    await expect(armazem.salvar('../roma', DADOS, new Date())).rejects.toThrow(/Slug/);
    await expect(armazem.salvar('a/b', DADOS, new Date())).rejects.toThrow(/Slug/);
  });
});

describe('execução da sincronização', () => {
  it('começa ociosa', () => {
    const { execucao } = montar(vi.fn());
    expect(execucao.estado('roma')).toEqual({ situacao: 'ociosa' });
  });

  it('roda em segundo plano, mostra o progresso e termina concluída com o resumo', async () => {
    const controlada = sincronizacaoControlada();
    const { execucao, relogio, situacao } = montar(controlada.sincronizar);
    const iniciadaEm = relogio.agora().toISOString();

    expect(execucao.iniciar('roma', acesso)).toEqual({
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
        avisos: ['aviso sintético'],
      },
    });
    const gravado = JSON.parse(await readFile(path.join(dir, 'roma.json'), 'utf8'));
    expect([gravado.produtos.length, gravado.clientes.length]).toEqual([2, 1]);
  });

  it('um segundo iniciar durante o job devolve o mesmo estado sem nova leitura', async () => {
    const controlada = sincronizacaoControlada();
    const { execucao, relogio, situacao } = montar(controlada.sincronizar);
    const primeiro = execucao.iniciar('roma', acesso);
    relogio.avancar(5000);

    expect(execucao.iniciar('roma', acesso)).toEqual(primeiro);
    expect(controlada.sincronizar).toHaveBeenCalledTimes(1);

    controlada.liberar();
    await situacao('roma', 'concluida');
    execucao.iniciar('roma', acesso);
    expect(controlada.sincronizar).toHaveBeenCalledTimes(2);
  });

  it('empresas diferentes têm jobs independentes', () => {
    const controlada = sincronizacaoControlada();
    const { execucao } = montar(controlada.sincronizar);
    execucao.iniciar('roma', acesso);
    execucao.iniciar('outra', acesso);
    expect(controlada.sincronizar).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['ErroBlingNaoConectado', new ErroBlingNaoConectado(), 'bling_nao_conectado'],
    ['ErroBlingNaoAutorizado', new ErroBlingNaoAutorizado(), 'bling_nao_conectado'],
    ['ErroBlingIndisponivel', new ErroBlingIndisponivel('SERVER_ERROR', 500), 'bling_indisponivel'],
    ['erro qualquer', new Error('detalhe interno'), 'erro_interno'],
  ])('%s no meio do job → falhou com %s', async (_, erro, codigo) => {
    const controlada = sincronizacaoControlada();
    const { execucao, aoFalhar, situacao } = montar(controlada.sincronizar);
    execucao.iniciar('roma', acesso);
    controlada.falhar(erro);

    const estado = await situacao('roma', 'falhou');
    expect(estado).toMatchObject({ erro: { codigo } });
    expect(JSON.stringify(estado)).not.toMatch(/detalhe interno|SERVER_ERROR/);
    expect(aoFalhar).toHaveBeenCalledTimes(codigo === 'erro_interno' ? 1 : 0);
    await expect(readdir(dir)).resolves.toEqual([]);
  });

  it('falha síncrona do sincronizar também termina o job', async () => {
    const sincronizar = vi.fn<ExecutarSincronizacao>(() => {
      throw new Error('síncrono');
    });
    const { execucao, situacao } = montar(sincronizar);
    execucao.iniciar('roma', acesso);
    await situacao('roma', 'falhou');
    execucao.iniciar('roma', acesso);
    expect(sincronizar).toHaveBeenCalledTimes(2);
  });

  it('falha ao gravar o arquivo → falhou com erro interno', async () => {
    const controlada = sincronizacaoControlada();
    const armazem = { salvar: vi.fn().mockRejectedValue(new Error('disco cheio')) };
    const { execucao, situacao } = montar(controlada.sincronizar, armazem);
    execucao.iniciar('roma', acesso);
    controlada.liberar();
    expect(await situacao('roma', 'falhou')).toMatchObject({ erro: { codigo: 'erro_interno' } });
  });

  it('encerrar aborta os jobs e espera terminarem, sem gravar', async () => {
    const controlada = sincronizacaoControlada();
    const { execucao, aoFalhar } = montar(controlada.sincronizar);
    execucao.iniciar('roma', acesso);

    await execucao.encerrar();

    const sinal = controlada.sincronizar.mock.calls[0]?.[0].sinal;
    expect(sinal?.aborted).toBe(true);
    expect(execucao.estado('roma').situacao).toBe('falhou');
    expect(aoFalhar).not.toHaveBeenCalled();
    await expect(readdir(dir)).resolves.toEqual([]);
  });

  it('encerrar sem jobs não faz nada', async () => {
    const { execucao } = montar(vi.fn());
    await expect(execucao.encerrar()).resolves.toBeUndefined();
  });
});
