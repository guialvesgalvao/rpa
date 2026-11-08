import { describe, expect, it } from 'vitest';

import {
  acaoDoStatus,
  descreverEvento,
  filtrosDeTarefas,
  formatarDataHora,
  formatarTamanho,
} from '../../src/app/artes/tarefas-dados.js';

describe('filtrosDeTarefas', () => {
  it('admin: abre em andamento, com Todas e cada status (de todos)', () => {
    const filtros = filtrosDeTarefas('andamento');
    expect(filtros.slice(0, 2)).toEqual([
      { valor: '', rotulo: 'Em andamento', consulta: { escopo: 'andamento' } },
      { valor: 'todas', rotulo: 'Todas', consulta: { escopo: 'todas' } },
    ]);
    expect(filtros.find((f) => f.valor === 'cancelada')?.consulta).toEqual({
      escopo: 'todas',
      status: 'cancelada',
    });
  });

  it('minhas: abre em todas as do usuário e filtra por status só nelas', () => {
    const filtros = filtrosDeTarefas('minhas');
    expect(filtros[0]).toEqual({ valor: '', rotulo: 'Todas', consulta: { escopo: 'minhas' } });
    expect(filtros.map((f) => f.rotulo)).toContain('Aguardando validação do cliente');
    expect(filtros.every((f) => f.consulta.escopo === 'minhas')).toBe(true);
  });
});

describe('formatação', () => {
  it('tamanho em B, KB e MB', () => {
    expect(formatarTamanho(820)).toBe('820 B');
    expect(formatarTamanho(12 * 1024)).toBe('12 KB');
    expect(formatarTamanho(3.4 * 1024 * 1024)).toBe('3,4 MB');
  });

  it('data e hora locais', () => {
    expect(formatarDataHora(new Date(2026, 10, 5, 9, 7).toISOString())).toBe('05/11/2026 09:07');
  });

  it('descreve a criação e as mudanças de status', () => {
    expect(descreverEvento({ statusAnterior: null, statusNovo: 'nao_iniciada' })).toBe(
      'Criada como Não iniciado',
    );
    expect(descreverEvento({ statusAnterior: 'em_desenvolvimento', statusNovo: 'concluida' })).toBe(
      'Em desenvolvimento → Concluída',
    );
  });
});

describe('acaoDoStatus', () => {
  it('mesmo status: nada; concluir sem arte: pede a arte; o resto muda', () => {
    const semArte = { status: 'em_desenvolvimento' as const, arteId: null };
    expect(acaoDoStatus('em_desenvolvimento', semArte)).toBe('nada');
    expect(acaoDoStatus('concluida', semArte)).toBe('pedir_arte');
    expect(acaoDoStatus('cancelada', semArte)).toBe('mudar');
    expect(acaoDoStatus('concluida', { ...semArte, arteId: 'a' })).toBe('mudar');
  });
});
