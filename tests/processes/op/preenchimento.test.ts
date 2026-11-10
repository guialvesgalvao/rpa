import { describe, expect, it } from 'vitest';

import {
  dataLocal,
  limitarLinhas,
  normalizarPreenchimento,
  observacaoDoPedido,
  temPreenchimento,
} from '../../../src/processes/op/preenchimento.js';
import { PASSOS_PROCESSO } from '../../../src/processes/op/template.js';

describe('dataLocal', () => {
  it('converte AAAA-MM-DD para a meia-noite local', () => {
    expect(dataLocal('2026-11-20')).toEqual(new Date(2026, 10, 20));
  });

  it('recusa formato errado e dia que não existe', () => {
    for (const valor of ['20/11/2026', '2026-11-2', '2026-02-30', '2026-13-01', '']) {
      expect(dataLocal(valor)).toBeUndefined();
    }
  });
});

describe('limitarLinhas', () => {
  it('mantém o texto com até o máximo de linhas', () => {
    expect(limitarLinhas('a\r\nb\nc', 3)).toBe('a\nb\nc');
  });

  it('junta com espaço as linhas que passam do máximo', () => {
    expect(limitarLinhas('a\nb\nc\nd', 2)).toBe('a\nb c d');
  });
});

describe('normalizarPreenchimento', () => {
  it('sem dados (ou só espaços), devolve undefined', () => {
    expect(normalizarPreenchimento(undefined)).toBeUndefined();
    expect(
      normalizarPreenchimento({
        dataEntrega: '',
        processo: PASSOS_PROCESSO.map(() => ({ quantidade: '  ', responsavel: '', data: '' })),
        observacao: ' \n ',
      }),
    ).toBeUndefined();
    expect(temPreenchimento({ observacao: '   ' })).toBe(false);
  });

  it('tira espaços e campos vazios e devolve uma linha por passo', () => {
    const resultado = normalizarPreenchimento({
      dataEntrega: '2026-11-20',
      processo: [{ aplica: 'sim', quantidade: ' 1000 ', responsavel: '', data: '' }],
      observacao: '  Fundo e tampa juntos  ',
    });
    expect(resultado).toEqual({
      dataEntrega: '2026-11-20',
      processo: [
        { aplica: 'sim', quantidade: '1000' },
        ...PASSOS_PROCESSO.slice(1).map(() => ({})),
      ],
      observacao: 'Fundo e tampa juntos',
    });
    expect(temPreenchimento(resultado)).toBe(true);
  });

  it('só com a observação, não manda o processo', () => {
    expect(normalizarPreenchimento({ processo: [{}], observacao: 'x' })).toEqual({
      observacao: 'x',
    });
  });
});

describe('observacaoDoPedido', () => {
  it('cabe na OP: volta igual, sem corte', () => {
    expect(observacaoDoPedido(' Entregar até as 8h ')).toEqual({
      texto: 'Entregar até as 8h',
      cortada: false,
    });
    expect(observacaoDoPedido('a\nb\nc\nd')).toEqual({ texto: 'a\nb\nc\nd', cortada: false });
  });

  it('mais de 4 linhas: as a mais viram espaço e conta como corte', () => {
    expect(observacaoDoPedido('a\nb\nc\nd\ne')).toEqual({ texto: 'a\nb\nc\nd e', cortada: true });
  });

  it('mais de 400 caracteres: corta no limite', () => {
    const resultado = observacaoDoPedido('x'.repeat(401));
    expect(resultado).toEqual({ texto: 'x'.repeat(400), cortada: true });
  });

  it('vazia ou ausente: undefined', () => {
    expect(observacaoDoPedido(undefined)).toBeUndefined();
    expect(observacaoDoPedido('   ')).toBeUndefined();
  });
});
