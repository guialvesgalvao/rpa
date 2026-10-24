import { describe, expect, it } from 'vitest';

import { criarRastro, primeiraLinha } from '../../src/core/rastro.js';

describe('criarRastro', () => {
  it('registra o passo ok e devolve o resultado', async () => {
    const rastro = criarRastro();
    await expect(rastro.etapa('Busquei o pedido', async () => 42)).resolves.toBe(42);
    expect(rastro.passos).toEqual([{ texto: 'Busquei o pedido', status: 'ok' }]);
  });

  it('em erro registra a 1ª linha da mensagem e relança', async () => {
    const rastro = criarRastro();
    const falha = new Error('Timeout 5000ms\nCall log:\n  - waiting for locator');
    await expect(
      rastro.etapa('Cliquei em Emitir boletos', async () => {
        throw falha;
      }),
    ).rejects.toBe(falha);
    expect(rastro.passos).toEqual([
      { texto: 'Cliquei em Emitir boletos', status: 'erro', erro: 'Timeout 5000ms' },
    ]);
  });

  it('continua os passos iniciais sem alterar o array de origem', async () => {
    const inicial = [{ texto: 'Li os dados do pedido', status: 'ok' as const }];
    const rastro = criarRastro(inicial);
    await rastro.etapa('Salvei arquivo.pdf', async () => undefined);
    expect(rastro.passos.map((p) => p.texto)).toEqual([
      'Li os dados do pedido',
      'Salvei arquivo.pdf',
    ]);
    expect(inicial).toHaveLength(1);
  });
});

describe('primeiraLinha', () => {
  it('erro e valor que não é Error', () => {
    expect(primeiraLinha(new Error('a\nb'))).toBe('a');
    expect(primeiraLinha('texto')).toBe('texto');
  });
});
