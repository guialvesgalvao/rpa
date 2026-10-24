import { describe, expect, it } from 'vitest';

import { extrairDadosPedido } from '../../../src/processes/bling/pedido.js';

const data = (dia: number, mes: number, ano: number): Date => new Date(ano, mes - 1, dia);

/** Resposta sintética de `obterVenda`, só com os campos usados (sem dados reais). */
function resposta({
  numeroPedido = '1001',
  nome = 'Empresa Exemplo Ltda',
  fantasia = 'Exemplo',
  vencimentos = ['19/10/2026'],
  idNotaFiscalRef = '0',
}: {
  numeroPedido?: string | number;
  nome?: string;
  fantasia?: string;
  vencimentos?: string[];
  idNotaFiscalRef?: string | number;
} = {}) {
  return {
    venda: { id: '1', numeroPedido, idNotaFiscalRef },
    contato: { dadosContato: { id: '9', nome, fantasia } },
    jsonParcelas: vencimentos.map((dataVencimento, i) => ({
      nroDias: (i + 1) * 7,
      dataVencimento,
      valor: '10.00',
    })),
  };
}

describe('extrairDadosPedido', () => {
  it('usa o nome fantasia e a única parcela', () => {
    expect(extrairDadosPedido(resposta(), '1001')).toEqual({
      numero: '1001',
      cliente: 'Exemplo',
      parcelas: [data(19, 10, 2026)],
      possuiNf: false,
    });
  });

  it('possuiNf quando idNotaFiscalRef aponta para uma nota', () => {
    expect(extrairDadosPedido(resposta({ idNotaFiscalRef: '12345' }), '1001').possuiNf).toBe(true);
    expect(extrairDadosPedido(resposta({ idNotaFiscalRef: 12345 }), '1001').possuiNf).toBe(true);
  });

  it('sem NF quando idNotaFiscalRef é "0", 0, vazio ou ausente', () => {
    for (const idNotaFiscalRef of ['0', 0, '', ' ']) {
      expect(extrairDadosPedido(resposta({ idNotaFiscalRef }), '1001').possuiNf).toBe(false);
    }
    const semCampo = resposta();
    delete (semCampo.venda as { idNotaFiscalRef?: unknown }).idNotaFiscalRef;
    expect(extrairDadosPedido(semCampo, '1001').possuiNf).toBe(false);
  });

  it('sem fantasia (vazia ou só espaços), usa o nome principal', () => {
    expect(extrairDadosPedido(resposta({ fantasia: '   ' }), '1001').cliente).toBe(
      'Empresa Exemplo Ltda',
    );
  });

  it('tira espaços das pontas do nome fantasia', () => {
    expect(extrairDadosPedido(resposta({ fantasia: ' Exemplo ' }), '1001').cliente).toBe('Exemplo');
  });

  it('4 parcelas na ordem de jsonParcelas, inclusive na virada de mês', () => {
    const dados = extrairDadosPedido(
      resposta({ vencimentos: ['19/10/2026', '26/10/2026', '02/11/2026', '09/11/2026'] }),
      '1001',
    );
    expect(dados.parcelas).toEqual([
      data(19, 10, 2026),
      data(26, 10, 2026),
      data(2, 11, 2026),
      data(9, 11, 2026),
    ]);
  });

  it('aceita numeroPedido numérico', () => {
    expect(extrairDadosPedido(resposta({ numeroPedido: 1001 }), '1001').numero).toBe('1001');
  });

  it('erro se o Bling abriu outro pedido', () => {
    expect(() => extrairDadosPedido(resposta({ numeroPedido: '1002' }), '1001')).toThrow(
      'O Bling abriu o pedido 1002 em vez do 1001',
    );
  });

  it('erro claro quando falta campo', () => {
    const semParcelas = { ...resposta(), jsonParcelas: undefined };
    expect(() => extrairDadosPedido(semParcelas, '1001')).toThrow(
      'Dados do pedido 1001 em formato inesperado (jsonParcelas)',
    );
    expect(() => extrairDadosPedido(null, '1001')).toThrow('formato inesperado');
  });

  it('erro sem parcelas', () => {
    expect(() => extrairDadosPedido(resposta({ vencimentos: [] }), '1001')).toThrow(
      'Pedido 1001 sem parcelas',
    );
  });

  it('erro sem nome de cliente', () => {
    expect(() => extrairDadosPedido(resposta({ nome: '', fantasia: '' }), '1001')).toThrow(
      'Pedido 1001 sem nome de cliente',
    );
  });

  it('erro com data de vencimento inválida', () => {
    for (const invalida of ['2026-10-19', '31/02/2026', '']) {
      expect(() => extrairDadosPedido(resposta({ vencimentos: [invalida] }), '1001')).toThrow(
        'Data de vencimento inválida',
      );
    }
  });
});
