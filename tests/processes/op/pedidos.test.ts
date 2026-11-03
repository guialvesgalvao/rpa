import path from 'node:path';
import { describe, expect, it } from 'vitest';

import type { PedidoOp } from '../../../src/processes/bling/pedido-op.js';
import { lerPedidos, lerPedidosMock } from '../../../src/processes/op/pedidos.js';

const fixture = path.resolve('tests/fixtures/pedido-op.json');

describe('lerPedidos', () => {
  it('lê na ordem; a falha de um vira erro só dele, com o passo a passo', async () => {
    const falhas: string[] = [];
    const lidos = await lerPedidos(
      ['1', '2', '3'],
      async (numero, rastro) => {
        if (numero === '2') {
          await rastro.etapa('Busquei o pedido 2 na listagem', async () => {
            throw new Error('Pedido 2 não encontrado\nlog do Playwright');
          });
        }
        return { numero } as PedidoOp;
      },
      async (numero) => void falhas.push(numero),
    );

    expect(lidos.map((l) => ('erro' in l ? `erro:${l.numero}` : l.numero))).toEqual([
      '1',
      'erro:2',
      '3',
    ]);
    expect(lidos[1]).toEqual({
      numero: '2',
      erro: 'Pedido 2 não encontrado',
      passos: [
        {
          texto: 'Busquei o pedido 2 na listagem',
          status: 'erro',
          erro: 'Pedido 2 não encontrado',
        },
      ],
    });
    expect(falhas).toEqual(['2']);
  });
});

describe('lerPedidosMock', () => {
  it('cada número vira um pedido da fixture com aquele número', async () => {
    const lidos = await lerPedidosMock(['10', '11'], fixture);
    expect(lidos.map((l) => ('pedido' in l ? l.pedido.numero : l.erro))).toEqual(['10', '11']);
  });

  it('fixture ausente vira erro por pedido', async () => {
    const [lido] = await lerPedidosMock(['10'], path.resolve('tests/fixtures/nao-existe.json'));
    expect(lido).toMatchObject({ numero: '10', erro: expect.stringContaining('ENOENT') });
  });
});
