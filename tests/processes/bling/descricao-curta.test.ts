import { describe, expect, it } from 'vitest';

import {
  emParalelo,
  lerDescricaoCurta,
  type PaginaBling,
  textoDaDescricao,
} from '../../../src/processes/bling/descricao-curta.js';

/** Página falsa: o `evaluate` devolve a resposta dada e guarda o id pedido. */
function paginaFalsa(resposta: { status: number; corpo: string }) {
  const ids: string[] = [];
  const page = {
    evaluate: async (_fn: unknown, id: string) => {
      ids.push(id);
      return resposta;
    },
  } as unknown as PaginaBling;
  return { page, ids };
}

const corpo = (descricaoCurta: unknown) => JSON.stringify({ data: { id: 1, descricaoCurta } });

describe('textoDaDescricao', () => {
  it('parágrafos e <br> viram linhas; tags somem; entidades são decodificadas', () => {
    expect(
      textoDaDescricao(
        '<p>Caixa <strong>35 x 35</strong> cm</p><p>Papel&nbsp;kraft<br/>tampa &amp; fundo</p>',
      ),
    ).toBe('Caixa 35 x 35 cm\nPapel kraft\ntampa & fundo');
  });

  it('acentos em entidades nomeadas e numéricas', () => {
    expect(textoDaDescricao('Impress&atilde;o &Aacute; &ccedil; &#233; &#xE7; 2&ordm;')).toBe(
      'Impressão Á ç é ç 2º',
    );
  });

  it('listas viram linhas com hífen e linhas vazias em excesso saem', () => {
    expect(textoDaDescricao('<ul><li>Um</li><li>Dois</li></ul><p></p><p></p><p>Fim</p>')).toBe(
      '- Um\n- Dois\n\nFim',
    );
  });

  it('texto escapado continua texto; script e style somem; entidade desconhecida fica', () => {
    expect(
      textoDaDescricao('&lt;b&gt;x&lt;/b&gt; <script>alert(1)</script><style>p{}</style>'),
    ).toBe('<b>x</b>');
    expect(textoDaDescricao('a &naoexiste; b')).toBe('a &naoexiste; b');
  });

  it('só espaços, tags vazias ou nada: vazio', () => {
    for (const html of ['', '   ', '<p>&nbsp;</p>', '<p><br></p>\r\n']) {
      expect(textoDaDescricao(html)).toBe('');
    }
  });
});

describe('lerDescricaoCurta', () => {
  it('pede o produto pelo id e devolve o texto', async () => {
    const { page, ids } = paginaFalsa({ status: 200, corpo: corpo('<p>Formato 35</p>') });
    expect(await lerDescricaoCurta(page, '16735402907')).toBe('Formato 35');
    expect(ids).toEqual(['16735402907']);
  });

  it('sem descrição (vazia ou nula): undefined', async () => {
    for (const valor of ['', null, undefined, '<p></p>']) {
      const { page } = paginaFalsa({ status: 200, corpo: corpo(valor) });
      expect(await lerDescricaoCurta(page, '1')).toBeUndefined();
    }
  });

  it('falha com status de erro, JSON inválido ou formato inesperado', async () => {
    await expect(
      lerDescricaoCurta(paginaFalsa({ status: 404, corpo: '' }).page, '1'),
    ).rejects.toThrow('O Bling respondeu 404');
    await expect(
      lerDescricaoCurta(paginaFalsa({ status: 200, corpo: '<html>' }).page, '1'),
    ).rejects.toThrow('não é JSON');
    await expect(
      lerDescricaoCurta(paginaFalsa({ status: 200, corpo: '{"erro":1}' }).page, '1'),
    ).rejects.toThrow('formato inesperado');
  });

  it('recusa id que não é numérico, sem chamar o Bling', async () => {
    const { page, ids } = paginaFalsa({ status: 200, corpo: corpo('x') });
    await expect(lerDescricaoCurta(page, '1/../2')).rejects.toThrow('Id de produto');
    expect(ids).toEqual([]);
  });
});

describe('emParalelo', () => {
  it('processa todos com no máximo `limite` ao mesmo tempo', async () => {
    let ativos = 0;
    let pico = 0;
    const feitos: number[] = [];
    await emParalelo([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
      ativos++;
      pico = Math.max(pico, ativos);
      await new Promise((r) => setTimeout(r, 5));
      feitos.push(n);
      ativos--;
    });
    expect(feitos.sort()).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(pico).toBe(3);
  });
});
