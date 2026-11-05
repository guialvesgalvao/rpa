import { describe, expect, it } from 'vitest';

import { textoProgressoBling, textoResultadoBling } from '../../src/app/sincronizacao.js';

describe('textoProgressoBling', () => {
  it('descreve cada etapa', () => {
    expect(textoProgressoBling({ etapa: 'produtos', lidos: 200, total: null })).toBe(
      'Lendo produtos…',
    );
    expect(textoProgressoBling({ etapa: 'clientes', lidos: 0, total: null })).toBe(
      'Lendo clientes…',
    );
    expect(textoProgressoBling({ etapa: 'detalhes', lidos: 120, total: 950 })).toBe(
      'Detalhando clientes: 120 de 950',
    );
    expect(textoProgressoBling({ etapa: 'detalhes', lidos: 0, total: null })).toBe(
      'Detalhando clientes…',
    );
  });
});

describe('textoResultadoBling', () => {
  // Hora local: o teste monta o ISO a partir de uma data local para não depender do fuso.
  const concluidaEm = new Date(2026, 10, 4, 14, 5).toISOString();

  it('resume as contagens com a hora', () => {
    expect(
      textoResultadoBling({
        situacao: 'concluida',
        resumo: { produtos: 12, clientes: 1, concluidaEm, avisos: [] },
      }),
    ).toBe('12 produtos e 1 cliente lidos às 14:05.');
  });

  it('mostra até três avisos e conta o resto', () => {
    const avisos = ['A.', 'B.', 'C.', 'D.', 'E.'];
    expect(
      textoResultadoBling({
        situacao: 'concluida',
        resumo: { produtos: 1, clientes: 0, concluidaEm, avisos },
      }),
    ).toBe('1 produto e 0 clientes lidos às 14:05. Avisos: A. B. C. (e mais 2 avisos)');
  });

  it('pede a autorização no navegador ou repassa o erro', () => {
    expect(textoResultadoBling({ situacao: 'autorizacao_aberta' })).toBe(
      'Autorize o acesso ao Bling no navegador e clique em Sincronizar dados de novo.',
    );
    expect(
      textoResultadoBling({
        situacao: 'erro',
        mensagem: 'Sincronização não configurada no servidor.',
      }),
    ).toBe('Sincronização não configurada no servidor.');
  });
});
