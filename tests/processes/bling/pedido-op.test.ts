import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  comFormato,
  ERRO_SEM_INSUMOS,
  extrairPedidoOp,
  fonteMock,
  type ItemOp,
  mockAtivo,
} from '../../../src/processes/bling/pedido-op.js';

const caminho = resolve(import.meta.dirname, '../../fixtures/pedido-op.json');
const caminhoProdutos = resolve(import.meta.dirname, '../../fixtures/produtos-op.json');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const carregar = () => JSON.parse(readFileSync(caminho, 'utf8')) as Record<string, any>;
const data = (d: number, m: number, a: number) => new Date(a, m - 1, d);

describe('extrairPedidoOp', () => {
  it('lê cliente, datas, CNPJ e itens da fixture, descartando serviço', () => {
    const p = extrairPedidoOp(carregar(), '9001');
    expect(p).toMatchObject({
      numero: '9001',
      clienteNome: 'Cliente Ficticio Ltda',
      clienteFantasia: 'Pizzaria Ficticia',
      cnpj: '11222333000181',
      dataVenda: data(12, 10, 2026),
      dataPrevista: data(20, 10, 2026),
    });
    expect(p.itens.map((i) => i.codigo)).toEqual(['900001', '900002']);
  });

  it('traz insumos com quantidade por unidade numérica', () => {
    const [item] = extrairPedidoOp(carregar()).itens;
    expect(item).toMatchObject({
      descricao: 'Caixa de Pizza Sintetica 35',
      unidade: 'UN',
      quantidade: 1000,
    });
    expect(item?.erro).toBeUndefined();
    expect(item?.insumos).toEqual([
      { nome: 'Papel sintetico A', unidade: 'UN', quantidadePorUnidade: 0.5 },
      { nome: 'Papel sintetico A + 46x46', unidade: 'UN', quantidadePorUnidade: 0.5 },
    ]);
  });

  it('marca erro só no item sem componentes, mantendo os demais', () => {
    const [ok, semInsumos] = extrairPedidoOp(carregar()).itens;
    expect(ok?.erro).toBeUndefined();
    expect(semInsumos).toMatchObject({ codigo: '900002', erro: ERRO_SEM_INSUMOS });
    expect(semInsumos?.insumos).toBeUndefined();
  });

  it('deixa dataPrevista ausente quando vazia ou nula', () => {
    for (const valor of ['', null]) {
      const json = carregar();
      json.venda.dataPrevista = valor;
      expect(extrairPedidoOp(json).dataPrevista).toBeUndefined();
    }
  });

  it('normaliza CNPJ com máscara e cai para venda.cnpj', () => {
    const json = carregar();
    json.contato.dadosContato.cnpj = '';
    json.venda.cnpj = '11.222.333/0001-81';
    expect(extrairPedidoOp(json).cnpj).toBe('11222333000181');
  });

  it('ignora CPF (11 dígitos) como CNPJ', () => {
    const json = carregar();
    json.contato.dadosContato.cnpj = '123.456.789-09';
    json.venda.cnpj = '123.456.789-09';
    expect(extrairPedidoOp(json).cnpj).toBeUndefined();
  });

  it('usa a fantasia como nome quando não há nome e omite fantasia vazia', () => {
    const json = carregar();
    json.contato.dadosContato.nome = '';
    expect(extrairPedidoOp(json).clienteNome).toBe('Pizzaria Ficticia');
    json.contato.dadosContato.fantasia = '';
    json.contato.dadosContato.nome = 'Só Nome';
    expect(extrairPedidoOp(json).clienteFantasia).toBeUndefined();
  });

  it('rejeita pedido diferente do esperado, data inválida e formato inesperado', () => {
    expect(() => extrairPedidoOp(carregar(), '1')).toThrow('em vez do 1');
    const json = carregar();
    json.venda.data = '31/02/2026';
    expect(() => extrairPedidoOp(json)).toThrow('Data da venda inválida');
    expect(() => extrairPedidoOp({}, '9001')).toThrow('formato inesperado');
  });
});

describe('Formato (Descrição curta)', () => {
  it('guarda o id do produto do Bling de cada item', () => {
    expect(extrairPedidoOp(carregar()).itens.map((i) => i.idProdutoBling)).toEqual([
      '2001',
      '2002',
    ]);
    const json = carregar();
    delete json.itens[0].produto;
    expect(extrairPedidoOp(json).itens[0]).not.toHaveProperty('idProdutoBling');
  });

  it('lê só os itens que geram OP; a falha de um vira aviso e os outros seguem', async () => {
    const pedido = extrairPedidoOp(carregar());
    const extra: ItemOp = { ...pedido.itens[0]!, codigo: '900003', idProdutoBling: '2003' };
    const semDescricao: ItemOp = { ...pedido.itens[0]!, codigo: '900004', idProdutoBling: '2004' };
    const lidos: string[] = [];
    const avisos: string[] = [];
    const resultado = await comFormato(
      { ...pedido, itens: [...pedido.itens, extra, semDescricao] },
      async (id) => {
        lidos.push(id);
        if (id === '2003') throw new Error('O Bling respondeu 500');
        return id === '2001' ? 'Formato 35' : undefined;
      },
      (item, error) => avisos.push(`${item.codigo}: ${(error as Error).message}`),
    );
    expect(lidos.sort()).toEqual(['2001', '2003', '2004']);
    expect(resultado.itens.map((i) => i.formato)).toEqual([
      'Formato 35',
      undefined,
      undefined,
      undefined,
    ]);
    expect(avisos).toEqual(['900003: O Bling respondeu 500']);
  });
});

describe('fonte fictícia', () => {
  it('traz o Formato da fixture de produtos, em texto', async () => {
    const p = await fonteMock(caminho, caminhoProdutos)('1234');
    expect(p.itens[0]?.formato).toBe('Formato fictício: 35 x 35 cm\nTampa e fundo & reforço');
    expect(p.itens[1]?.formato).toBeUndefined();
  });

  it('lê a fixture sem navegador, com o número pedido', async () => {
    const p = await fonteMock(caminho)('1234');
    expect(p.numero).toBe('1234');
    expect(p.itens).toHaveLength(2);
    expect((await fonteMock(caminho)('1235')).numero).toBe('1235');
  });

  it('só liga com RPA_OP_MOCK=1', () => {
    expect(mockAtivo({ RPA_OP_MOCK: '1' })).toBe(true);
    expect(mockAtivo({})).toBe(false);
    expect(mockAtivo({ RPA_OP_MOCK: '0' })).toBe(false);
  });
});

describe('observação do pedido', () => {
  it('lê as "Observações" (não as internas), sem espaços em volta', () => {
    const json = carregar();
    json.venda.observacoes = '  Entregar até as 8h \n';
    json.venda.observacaoInterna = 'Interna, não vai para a OP';
    expect(extrairPedidoOp(json).observacao).toBe('Entregar até as 8h');
  });

  it('vazia, só com espaços ou ausente: sem observação', () => {
    for (const valor of ['', '   ', null, undefined]) {
      const json = carregar();
      json.venda.observacoes = valor;
      expect(extrairPedidoOp(json)).not.toHaveProperty('observacao');
    }
  });
});
