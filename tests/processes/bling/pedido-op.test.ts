import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  ERRO_SEM_INSUMOS,
  extrairPedidoOp,
  fonteMock,
  mockAtivo,
} from '../../../src/processes/bling/pedido-op.js';

const caminho = resolve(import.meta.dirname, '../../fixtures/pedido-op.json');
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
    expect(p.itens.map((i) => i.codigo)).toEqual(['XX0001', 'XX0002']);
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
    expect(semInsumos).toMatchObject({ codigo: 'XX0002', erro: ERRO_SEM_INSUMOS });
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

describe('fonte fictícia', () => {
  it('lê a fixture sem navegador', async () => {
    const p = await fonteMock(caminho)('qualquer');
    expect(p.numero).toBe('9001');
    expect(p.itens).toHaveLength(2);
  });

  it('só liga com RPA_OP_MOCK=1', () => {
    expect(mockAtivo({ RPA_OP_MOCK: '1' })).toBe(true);
    expect(mockAtivo({})).toBe(false);
    expect(mockAtivo({ RPA_OP_MOCK: '0' })).toBe(false);
  });
});
