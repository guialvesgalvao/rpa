import { describe, expect, it, vi } from 'vitest';

import type { Rastro } from '../../../src/core/rastro.js';
import {
  executarSelecao,
  type DocResult,
  type GeradorDoc,
} from '../../../src/processes/bling/documentos.js';

const preparar = async (numero: string, rastro: Rastro) =>
  rastro.etapa(`Li os dados do pedido ${numero}`, async () => ({ cliente: 'Cliente' }));

/** Gerador fake que registra a ordem das chamadas e um passo no rastro. */
function fake(nome: string, ordem: string[], falhar = false): GeradorDoc<unknown> {
  return async ({ numero, rastro }) =>
    rastro.etapa(`Gerei ${nome}`, async () => {
      ordem.push(`${numero}:${nome}`);
      if (falhar) throw new Error(`${nome} falhou\ndetalhe técnico`);
      return { arquivos: [`${nome}-${numero}.pdf`] };
    });
}

describe('executarSelecao', () => {
  it('executa os docs na ordem boleto → recibo → nf, qualquer que seja a ordem pedida', async () => {
    const ordem: string[] = [];
    const results = await executarSelecao([{ numero: '1', docs: ['nf', 'recibo', 'boleto'] }], {
      prepararPedido: preparar,
      geradores: {
        boleto: fake('boleto', ordem),
        recibo: fake('recibo', ordem),
        nf: fake('nf', ordem),
      },
    });
    expect(ordem).toEqual(['1:boleto', '1:recibo', '1:nf']);
    expect(results.map((r) => [r.doc, r.status])).toEqual([
      ['boleto', 'ok'],
      ['recibo', 'ok'],
      ['nf', 'ok'],
    ]);
  });

  it('a falha de um doc não afeta os outros nem o próximo pedido', async () => {
    const ordem: string[] = [];
    const onFalha = vi.fn(async () => undefined);
    const results = await executarSelecao(
      [
        { numero: '1', docs: ['boleto', 'recibo'] },
        { numero: '2', docs: ['boleto'] },
      ],
      {
        prepararPedido: preparar,
        geradores: { boleto: fake('boleto', ordem, true), recibo: fake('recibo', ordem) },
        onFalha,
      },
    );
    expect(ordem).toEqual(['1:boleto', '1:recibo', '2:boleto']);
    const [boleto1, recibo1, boleto2] = results;
    expect(boleto1).toMatchObject({
      numero: '1',
      doc: 'boleto',
      status: 'erro',
      erro: 'boleto falhou',
    });
    expect(boleto1!.passos).toEqual([
      { texto: 'Li os dados do pedido 1', status: 'ok' },
      { texto: 'Gerei boleto', status: 'erro', erro: 'boleto falhou' },
    ]);
    expect(recibo1).toMatchObject({ status: 'ok', arquivos: ['recibo-1.pdf'] });
    expect(recibo1!.passos!.map((p) => p.texto)).toEqual([
      'Li os dados do pedido 1',
      'Gerei recibo',
    ]);
    expect(boleto2).toMatchObject({ numero: '2', status: 'erro' });
    expect(onFalha).toHaveBeenCalledTimes(2);
    expect(onFalha).toHaveBeenCalledWith(expect.objectContaining({ numero: '1', etapa: 'boleto' }));
  });

  it('falha no prepararPedido falha todos os docs do pedido com o rastro dele', async () => {
    const ordem: string[] = [];
    const onFalha = vi.fn(async () => undefined);
    const results = await executarSelecao([{ numero: '9', docs: ['boleto', 'recibo'] }], {
      prepararPedido: (numero, rastro) =>
        rastro.etapa(`Busquei o pedido ${numero}`, async () => {
          throw new Error('Pedido 9 não encontrado');
        }),
      geradores: { boleto: fake('boleto', ordem), recibo: fake('recibo', ordem) },
      onFalha,
    });
    expect(ordem).toEqual([]);
    expect(results).toHaveLength(2);
    for (const r of results) {
      expect(r).toMatchObject({ status: 'erro', erro: 'Pedido 9 não encontrado' });
      expect(r.passos).toEqual([
        { texto: 'Busquei o pedido 9', status: 'erro', erro: 'Pedido 9 não encontrado' },
      ]);
    }
    expect(onFalha).toHaveBeenCalledTimes(1);
    expect(onFalha).toHaveBeenCalledWith(expect.objectContaining({ numero: '9', etapa: 'pedido' }));
  });

  it('onProgress emite processando → ok/erro para cada doc', async () => {
    const eventos: string[] = [];
    await executarSelecao([{ numero: '1', docs: ['boleto', 'recibo'] }], {
      prepararPedido: preparar,
      geradores: { boleto: fake('boleto', []), recibo: fake('recibo', [], true) },
      onProgress: (item: DocResult) => eventos.push(`${item.doc}:${item.status}`),
    });
    expect(eventos).toEqual([
      'boleto:processando',
      'boleto:ok',
      'recibo:processando',
      'recibo:erro',
    ]);
  });

  it('doc sem gerador vira erro "Documento ainda não disponível"', async () => {
    const results = await executarSelecao([{ numero: '1', docs: ['boleto', 'nf'] }], {
      prepararPedido: preparar,
      geradores: { boleto: fake('boleto', []) },
    });
    expect(results[0]).toMatchObject({ doc: 'boleto', status: 'ok' });
    expect(results[1]).toMatchObject({
      doc: 'nf',
      status: 'erro',
      erro: 'Documento ainda não disponível',
    });
  });

  it('pedido sem docs fica fora da execução', async () => {
    const prepararPedido = vi.fn(preparar);
    const results = await executarSelecao([{ numero: '1', docs: [] }], {
      prepararPedido,
      geradores: {},
    });
    expect(results).toEqual([]);
    expect(prepararPedido).not.toHaveBeenCalled();
  });
});
