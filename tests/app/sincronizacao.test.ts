import { describe, expect, it } from 'vitest';

import type { SincronizacaoAutomaticaBling } from '../../src/app/plataforma/contratos.js';
import {
  textoAutomaticaBling,
  textoContaBling,
  textoProgressoBling,
  textoResultadoBling,
} from '../../src/app/sincronizacao.js';

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
    ).toBe('12 produtos e 1 cliente atualizados às 14:05.');
  });

  it('mostra até três avisos e conta o resto', () => {
    const avisos = ['A.', 'B.', 'C.', 'D.', 'E.'];
    expect(
      textoResultadoBling({
        situacao: 'concluida',
        resumo: { produtos: 1, clientes: 0, concluidaEm, avisos },
      }),
    ).toBe('1 produto e 0 clientes atualizados às 14:05. Avisos: A. B. C. (e mais 2 avisos)');
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

describe('textoContaBling', () => {
  // Dados fictícios.
  it('mostra o nome e o CNPJ formatado da conta conectada', () => {
    expect(textoContaBling({ nome: 'Conta Fictícia Ltda', cnpj: '12345678000195' })).toBe(
      'Conectado a: Conta Fictícia Ltda (12.345.678/0001-95).',
    );
  });

  it('sem conexão ou com conta anterior à verificação', () => {
    expect(textoContaBling(null)).toBe('Conta do Bling não identificada.');
  });

  it('conta sem nome', () => {
    expect(textoContaBling({ nome: '', cnpj: '12345678000195' })).toBe(
      'Conectado a: conta sem nome (12.345.678/0001-95).',
    );
  });
});

describe('textoAutomaticaBling', () => {
  // Datas locais, para não depender do fuso da máquina.
  const agora = new Date(2026, 10, 5, 15, 0);
  const iso = (dia: number, h: number, m: number) => new Date(2026, 10, dia, h, m).toISOString();
  const status = (
    dados: Partial<SincronizacaoAutomaticaBling> = {},
  ): SincronizacaoAutomaticaBling => ({
    ligada: true,
    intervaloMinutos: 15,
    completaDias: 3,
    ultima: {
      tipo: 'incremental',
      origem: 'agendador',
      situacao: 'concluida',
      iniciadaEm: iso(5, 14, 29),
      concluidaEm: iso(5, 14, 30),
      produtos: 1,
      clientes: 3,
      avisos: [],
    },
    ultimaCompletaEm: iso(4, 10, 0),
    proximaCompletaEm: iso(7, 10, 0),
    conta: null,
    ...dados,
  });

  it('desligada no servidor', () => {
    expect(textoAutomaticaBling(status({ ligada: false }), agora)).toBe(
      'Sincronização automática desligada no servidor.',
    );
  });

  it('ligada, com o último ciclo e a próxima completa', () => {
    expect(textoAutomaticaBling(status(), agora)).toBe(
      'Automática a cada 15 min. Última: 14:30 (incremental), 3 clientes e 1 produto atualizados. ' +
        'Próxima completa em 07/11 às 10:00.',
    );
  });

  it('último ciclo de outro dia, pelo botão, com avisos limitados a três', () => {
    const ultima = {
      ...status().ultima!,
      tipo: 'completa' as const,
      origem: 'botao' as const,
      concluidaEm: iso(4, 9, 5),
      clientes: 1,
      produtos: 0,
      avisos: ['A.', 'B.', 'C.', 'D.'],
    };
    expect(textoAutomaticaBling(status({ ultima, proximaCompletaEm: null }), agora)).toBe(
      'Automática a cada 15 min. Última: 04/11 às 09:05 (completa, pelo botão), 1 cliente e ' +
        '0 produtos atualizados. Avisos: A. B. C. (e mais 1 aviso)',
    );
  });

  it('último ciclo que falhou, com a mensagem', () => {
    const ultima = {
      ...status().ultima!,
      situacao: 'falhou' as const,
      produtos: 0,
      clientes: 0,
      erro: {
        codigo: 'bling_indisponivel',
        mensagem: 'O Bling não respondeu como esperado. Tente de novo em alguns minutos.',
      },
    };
    expect(textoAutomaticaBling(status({ ultima }), agora)).toBe(
      'Automática a cada 15 min. Última falhou às 14:30 (incremental): O Bling não respondeu como ' +
        'esperado. Tente de novo em alguns minutos. Próxima completa em 07/11 às 10:00.',
    );
  });

  it('Bling não conectado', () => {
    const ultima = { ...status().ultima!, situacao: 'nao_conectado' as const };
    expect(textoAutomaticaBling(status({ ultima, proximaCompletaEm: null }), agora)).toBe(
      'Automática a cada 15 min. Bling não conectado: clique em Sincronizar dados para autorizar.',
    );
  });

  it('ligada, mas sem nenhum ciclo ainda', () => {
    expect(
      textoAutomaticaBling(
        status({ ultima: null, ultimaCompletaEm: null, proximaCompletaEm: null }),
        agora,
      ),
    ).toBe('Automática a cada 15 min. Ainda não rodou.');
  });
});
