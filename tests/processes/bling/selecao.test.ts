import { describe, expect, it } from 'vitest';

import {
  type EscolhaPedido,
  expandirIntervalo,
  montarSelecao,
  parseDocs,
  reconstruirEscolhas,
  selecaoParaGerar,
} from '../../../src/processes/bling/selecao.js';

describe('expandirIntervalo', () => {
  it('crescente e inclusivo', () => {
    expect(expandirIntervalo('10', '13')).toEqual({ numeros: ['10', '11', '12', '13'] });
  });

  it('decrescente', () => {
    expect(expandirIntervalo('100', '97')).toEqual({ numeros: ['100', '99', '98', '97'] });
  });

  it('um item', () => {
    expect(expandirIntervalo(' 2604 ', '2604')).toEqual({ numeros: ['2604'] });
  });

  it('os dois vazios', () => {
    expect(expandirIntervalo('', '  ')).toEqual({ numeros: [] });
  });

  it('só um preenchido', () => {
    expect(expandirIntervalo('10', '').erro).toBe('Preencha De e Até');
    expect(expandirIntervalo('', '10').erro).toBe('Preencha De e Até');
  });

  it('não numérico', () => {
    const r = expandirIntervalo('1a', '5');
    expect(r.numeros).toEqual([]);
    expect(r.erro).toBeDefined();
  });

  it('aceita até 200 itens', () => {
    const { numeros, erro } = expandirIntervalo('1', '200');
    expect(erro).toBeUndefined();
    expect(numeros).toHaveLength(200);
    expect(numeros.at(-1)).toBe('200');
  });

  it('recusa mais de 200 itens', () => {
    expect(expandirIntervalo('1', '201')).toEqual({
      numeros: [],
      erro: 'Intervalo com 201 pedidos (máx. 200)',
    });
    expect(expandirIntervalo('300', '100').erro).toBe('Intervalo com 201 pedidos (máx. 200)');
  });

  it('normaliza zeros à esquerda', () => {
    expect(expandirIntervalo('08', '10').numeros).toEqual(['8', '9', '10']);
  });
});

describe('montarSelecao', () => {
  it('une texto e intervalo sem duplicados, texto primeiro', () => {
    expect(montarSelecao('12\n5, abc', '10', '13')).toEqual({
      numeros: ['12', '5', '10', '11', '13'],
      invalidos: ['abc'],
    });
  });

  it('só intervalo', () => {
    expect(montarSelecao('', '3', '1').numeros).toEqual(['3', '2', '1']);
  });

  it('erro no intervalo mantém os números do texto', () => {
    expect(montarSelecao('7', '1', '')).toEqual({
      numeros: ['7'],
      invalidos: [],
      erroIntervalo: 'Preencha De e Até',
    });
  });
});

describe('reconstruirEscolhas', () => {
  it('pedido novo entra marcado com os documentos padrão disponíveis', () => {
    const escolhas = reconstruirEscolhas(['1', '2'], new Map(), ['boleto']);
    expect([...escolhas.keys()]).toEqual(['1', '2']);
    expect(escolhas.get('1')).toEqual({ marcado: true, docs: new Set(['boleto']) });
  });

  it('nota fiscal nunca entra por padrão', () => {
    const escolhas = reconstruirEscolhas(['1'], new Map(), ['boleto', 'recibo', 'nf']);
    expect(escolhas.get('1')!.docs).toEqual(new Set(['boleto', 'recibo']));
  });

  it('preserva a escolha de quem continua e descarta quem saiu', () => {
    const anterior: EscolhaPedido = { marcado: false, docs: new Set(['recibo']) };
    const anteriores = new Map([
      ['1', anterior],
      ['9', { marcado: true, docs: new Set(['boleto']) } as EscolhaPedido],
    ]);
    const escolhas = reconstruirEscolhas(['2', '1'], anteriores, ['boleto', 'recibo']);
    expect([...escolhas.keys()]).toEqual(['2', '1']);
    expect(escolhas.get('1')).toBe(anterior);
    expect(escolhas.get('2')!.docs).toEqual(new Set(['boleto', 'recibo']));
  });
});

describe('selecaoParaGerar', () => {
  it('só pedidos marcados com documento, docs na ordem fixa', () => {
    const escolhas = new Map<string, EscolhaPedido>([
      ['3', { marcado: true, docs: new Set(['nf', 'boleto']) }],
      ['1', { marcado: false, docs: new Set(['boleto']) }],
      ['2', { marcado: true, docs: new Set() }],
      ['4', { marcado: true, docs: new Set(['recibo']) }],
    ]);
    expect(selecaoParaGerar(escolhas)).toEqual([
      { numero: '3', docs: ['boleto', 'nf'] },
      { numero: '4', docs: ['recibo'] },
    ]);
  });

  it('lista vazia', () => {
    expect(selecaoParaGerar(new Map())).toEqual([]);
  });
});

describe('parseDocs', () => {
  const disponiveis = ['boleto', 'recibo'] as const;

  it('sem --docs, usa o padrão boleto,recibo', () => {
    expect(parseDocs(undefined, disponiveis)).toEqual(['boleto', 'recibo']);
  });

  it('padrão só com os disponíveis', () => {
    expect(parseDocs(undefined, ['boleto'])).toEqual(['boleto']);
  });

  it('um doc, com espaços e maiúsculas', () => {
    expect(parseDocs(' Recibo ', disponiveis)).toEqual(['recibo']);
  });

  it('ordem fixa e sem repetição', () => {
    expect(parseDocs('recibo,boleto,recibo', disponiveis)).toEqual(['boleto', 'recibo']);
  });

  it('nf indisponível', () => {
    expect(() => parseDocs('boleto,nf', disponiveis)).toThrow('Nota fiscal ainda não disponível');
  });

  it('nf aceita quando disponível', () => {
    expect(parseDocs('nf', ['boleto', 'recibo', 'nf'])).toEqual(['nf']);
  });

  it('com nf disponível, o padrão continua boleto,recibo', () => {
    expect(parseDocs(undefined, ['boleto', 'recibo', 'nf'])).toEqual(['boleto', 'recibo']);
  });

  it('nf junto com os outros, na ordem fixa', () => {
    expect(parseDocs('nf,recibo,boleto', ['boleto', 'recibo', 'nf'])).toEqual([
      'boleto',
      'recibo',
      'nf',
    ]);
  });

  it('doc desconhecido', () => {
    expect(() => parseDocs('boleto,carne', disponiveis)).toThrow(
      'Documento desconhecido em --docs: "carne" (use boleto, recibo)',
    );
  });

  it('valor vazio', () => {
    expect(() => parseDocs(' , ', disponiveis)).toThrow('Informe ao menos um documento em --docs');
  });
});
