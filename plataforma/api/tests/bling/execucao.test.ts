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
const ROMA = { id: 'id-roma-ficticio', slug: 'roma' };
const OUTRA = { id: 'id-outra-ficticio', slug: 'outra' };

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
  const execucao = criarExecucaoSincronizacao({
    sincronizar,
    armazem,
    relogio: relogio.agora,
    aoFalhar,
  });
  const situacao = async (empresa: string, esperada: EstadoSincronizacaoBling['situacao']) =>
    vi.waitFor(() => {
      const estado = execucao.estado(empresa);
      expect(estado.situacao).toBe(esperada);
      return EsquemaEstadoSincronizacaoBling.parse(estado);
    });
  return { execucao, relogio, aoFalhar, situacao, armazem };
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

    expect(execucao.iniciar(ROMA, acesso)).toEqual({
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
    const primeiro = execucao.iniciar(ROMA, acesso);
    relogio.avancar(5000);

    expect(execucao.iniciar(ROMA, acesso)).toEqual(primeiro);
    expect(controlada.sincronizar).toHaveBeenCalledTimes(1);

    controlada.liberar();
    await situacao('roma', 'concluida');
    execucao.iniciar(ROMA, acesso);
    expect(controlada.sincronizar).toHaveBeenCalledTimes(2);
  });

  it('empresas diferentes têm jobs independentes', () => {
    const controlada = sincronizacaoControlada();
    const { execucao } = montar(controlada.sincronizar);
    execucao.iniciar(ROMA, acesso);
    execucao.iniciar(OUTRA, acesso);
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
    execucao.iniciar(ROMA, acesso);
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
    execucao.iniciar(ROMA, acesso);
    await situacao('roma', 'falhou');
    execucao.iniciar(ROMA, acesso);
    expect(sincronizar).toHaveBeenCalledTimes(2);
  });

  it('falha ao gravar no banco → falhou com erro interno', async () => {
    const controlada = sincronizacaoControlada();
    const armazem = armazemFalso();
    armazem.salvar.mockRejectedValue(new Error('banco fora'));
    const { execucao, situacao } = montar(controlada.sincronizar, armazem);
    execucao.iniciar(ROMA, acesso);
    controlada.liberar();
    expect(await situacao('roma', 'falhou')).toMatchObject({ erro: { codigo: 'erro_interno' } });
  });

  it('encerrar aborta os jobs e espera terminarem, sem gravar', async () => {
    const controlada = sincronizacaoControlada();
    const { execucao, aoFalhar, armazem } = montar(controlada.sincronizar);
    execucao.iniciar(ROMA, acesso);

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
});
