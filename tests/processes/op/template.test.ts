import { describe, expect, it } from 'vitest';

import { nomeOp } from '../../../src/processes/op/pdf.js';
import {
  ALTURA_ARTE_MM,
  escaparHtml,
  formatarDataOp,
  formatarQuantidade,
  htmlDaOp,
  PASSOS_PROCESSO,
} from '../../../src/processes/op/template.js';
import type { OrdemProducao } from '../../../src/processes/op/tipos.js';

const opBase = (): OrdemProducao => ({
  numero: 12,
  data: new Date(2026, 10, 2),
  empresa: 'Roma Embalagens',
  cliente: { nome: 'Cliente Ficticio Ltda', fantasia: 'Pizzaria Ficticia' },
  numeroPedido: '9001',
  previsaoInicial: new Date(2026, 9, 12),
  previsaoFinal: new Date(2026, 9, 20),
  item: { descricao: 'Caixa Sintetica 35', codigo: 'XX0001', unidade: 'UN', quantidade: 1000 },
  insumos: [
    { nome: 'Papel sintetico A', unidade: 'UN', quantidadePorUnidade: 0.5 },
    { nome: 'Papel sintetico B', unidade: 'UN', quantidadePorUnidade: 1 },
  ],
});

const arte = { imagem: { bytes: new Uint8Array([1, 2, 3]), mime: 'image/png' } };

describe('formatação', () => {
  it('escapa os caracteres especiais de HTML', () => {
    expect(escaparHtml(`<b a="1" b='2'>&</b>`)).toBe(
      '&lt;b a=&quot;1&quot; b=&#39;2&#39;&gt;&amp;&lt;/b&gt;',
    );
  });

  it('formata datas locais e deixa a ausente como linha em branco', () => {
    expect(formatarDataOp(new Date(2026, 0, 5))).toBe('05/01/2026');
    expect(formatarDataOp(undefined)).toBe('__/__/____');
  });

  it('formata quantidades no padrão brasileiro com 2 casas', () => {
    expect(formatarQuantidade(1000)).toBe('1.000,00');
    expect(formatarQuantidade(0.5)).toBe('0,50');
  });
});

describe('htmlDaOp', () => {
  it('mostra número, datas, cliente fantasia e nº do pedido', () => {
    const html = htmlDaOp(opBase());
    expect(html).toContain('Ordem de Produção nº 12');
    expect(html).toContain('Data: 02/11/2026');
    expect(html).toContain('Pizzaria Ficticia');
    expect(html).not.toContain('Cliente Ficticio Ltda');
    expect(html).toContain('9001');
    expect(html).toContain('12/10/2026');
    expect(html).toContain('20/10/2026');
  });

  it('usa o nome do cliente quando não há fantasia', () => {
    const op = opBase();
    op.cliente = { nome: 'Cliente Ficticio Ltda', fantasia: '  ' };
    expect(htmlDaOp(op)).toContain('Cliente Ficticio Ltda');
  });

  it('deixa a previsão final em branco quando o pedido não tem data prevista', () => {
    const op = opBase();
    delete op.previsaoFinal;
    expect(htmlDaOp(op)).toMatch(/Previsão final<\/span><span class="valor">__\/__\/____/);
  });

  it('calcula a quantidade total de cada insumo pela quantidade do item', () => {
    const html = htmlDaOp(opBase());
    expect(html).toContain('500,00');
    expect(html).toMatch(/1,00<\/td>\s*<td class="num">1\.000,00/);
  });

  it('lista os 9 passos do processo com Sim/Não e data em branco', () => {
    const html = htmlDaOp(opBase());
    PASSOS_PROCESSO.forEach((passo, i) => expect(html).toContain(`${i + 1}) ${passo}`));
    expect(html.match(/class="marca">\( \)/g)).toHaveLength(PASSOS_PROCESSO.length * 2);
    expect(html.match(/____\/____\/______/g)).toHaveLength(PASSOS_PROCESSO.length);
  });

  it('escapa os textos vindos do pedido e da observação', () => {
    const op = opBase();
    op.item.descricao = '<script>alert(1)</script>';
    op.observacao = 'Fundo & tampa <juntos>';
    const html = htmlDaOp(op);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('Fundo &amp; tampa &lt;juntos&gt;');
  });

  it('sem arte, não tem o bloco de arte', () => {
    const html = htmlDaOp(opBase());
    expect(html).not.toContain('class="arte"');
    expect(html).not.toContain('class="detalhes"');
  });

  it('com arte, mostra a imagem, as máquinas e a cor', () => {
    const op = { ...opBase(), arte: { ...arte, maquinas: ['Favorit', 'Rekord'], cor: '4x0' } };
    const html = htmlDaOp(op);
    expect(html).toContain('class="arte"');
    expect(html).toContain('src="data:image/png;base64,AQID"');
    expect(html).toContain('Favorit, Rekord');
    expect(html).toContain('4x0');
    expect(html).toContain(`height: ${ALTURA_ARTE_MM}mm`);
    expect(ALTURA_ARTE_MM).toBe(44);
  });

  it('com arte sem imagem, mostra o aviso no lugar da imagem', () => {
    const html = htmlDaOp({ ...opBase(), arte: { maquinas: [], cor: 'Preto' } });
    expect(html).toContain('Arte sem imagem cadastrada');
    expect(html).not.toContain('data:image');
    expect(html).toContain('Preto');
  });

  it('recusa imagem com tipo fora da lista', () => {
    const op = {
      ...opBase(),
      arte: { imagem: { bytes: new Uint8Array([1]), mime: 'text/html' }, maquinas: [], cor: 'x' },
    };
    expect(() => htmlDaOp(op)).toThrow(/não suportado/);
  });

  it('usa a logo quando existe, senão o nome da empresa', () => {
    expect(htmlDaOp(opBase())).toContain('<div class="empresa">Roma Embalagens</div>');
    const comLogo = htmlDaOp({ ...opBase(), logo: arte.imagem });
    expect(comLogo).toContain('class="logo" src="data:image/png;base64,AQID"');
    expect(comLogo).not.toContain('<div class="empresa">');
  });
});

describe('nomeOp', () => {
  it('monta o nome com número, cliente e código, sem caracteres inválidos', () => {
    const op = opBase();
    op.cliente.fantasia = 'Pizzaria: Ficticia/Sul';
    expect(nomeOp(op)).toBe('OP 12 Pizzaria_ Ficticia_Sul XX0001.pdf');
  });
});
