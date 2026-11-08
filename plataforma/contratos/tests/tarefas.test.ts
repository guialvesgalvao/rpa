import { describe, expect, it } from 'vitest';

import {
  ATALHOS_TAREFAS,
  EsquemaConsultaTarefas,
  EsquemaContagemTarefas,
  EsquemaNovoComentario,
  precisaDaArteParaConcluir,
  ROTULOS_STATUS_TAREFA,
  rotuloAtalho,
  STATUS_EM_ANDAMENTO,
  STATUS_TAREFA,
  tituloTarefa,
} from '../src/index.ts';

describe('tarefas de arte', () => {
  it('tem rótulo para cada status, e "em andamento" não inclui as terminadas', () => {
    expect(STATUS_TAREFA.map((s) => ROTULOS_STATUS_TAREFA[s])).toEqual([
      'Não iniciado',
      'Em desenvolvimento',
      'Aguardando validação do cliente',
      'Concluída',
      'Cancelada',
    ]);
    expect(STATUS_EM_ANDAMENTO).not.toContain('concluida');
    expect(STATUS_EM_ANDAMENTO).not.toContain('cancelada');
  });

  it('consulta: escopo padrão "minhas"; escopo e status desconhecidos são recusados', () => {
    expect(EsquemaConsultaTarefas.parse({})).toEqual({ escopo: 'minhas' });
    expect(EsquemaConsultaTarefas.safeParse({ escopo: 'outras' }).success).toBe(false);
    expect(EsquemaConsultaTarefas.safeParse({ status: 'pausada' }).success).toBe(false);
  });

  it('comentário: aparado, nem vazio nem longo demais', () => {
    expect(EsquemaNovoComentario.parse({ texto: '  ok  ' })).toEqual({ texto: 'ok' });
    expect(EsquemaNovoComentario.safeParse({ texto: '   ' }).success).toBe(false);
    expect(EsquemaNovoComentario.safeParse({ texto: 'x'.repeat(2001) }).success).toBe(false);
  });

  it('contagem: inteiros não negativos dos três status não terminados', () => {
    const contagem = { nao_iniciada: 2, em_desenvolvimento: 0, aguardando_cliente: 1 };
    expect(EsquemaContagemTarefas.parse(contagem)).toEqual(contagem);
    expect(EsquemaContagemTarefas.safeParse({ ...contagem, nao_iniciada: -1 }).success).toBe(false);
    expect(EsquemaContagemTarefas.safeParse({ ...contagem, nao_iniciada: 1.5 }).success).toBe(
      false,
    );
    expect(Object.keys(contagem).sort()).toEqual([...STATUS_EM_ANDAMENTO].sort());
  });

  it('atalhos: Pendentes, Em andamento, Aguardando validação e Todos (sem status)', () => {
    expect(ATALHOS_TAREFAS.map((a) => [a.rotulo, a.status])).toEqual([
      ['Pendentes', 'nao_iniciada'],
      ['Em andamento', 'em_desenvolvimento'],
      ['Aguardando validação', 'aguardando_cliente'],
      ['Todos', null],
    ]);
    expect(new Set(ATALHOS_TAREFAS.map((a) => a.valor)).size).toBe(ATALHOS_TAREFAS.length);
  });

  it('rótulo do atalho: contador entre parênteses, menos em Todos e sem contagem', () => {
    const contagem = { nao_iniciada: 3, em_desenvolvimento: 0, aguardando_cliente: 12 };
    expect(ATALHOS_TAREFAS.map((a) => rotuloAtalho(a, contagem))).toEqual([
      'Pendentes (3)',
      'Em andamento (0)',
      'Aguardando validação (12)',
      'Todos',
    ]);
    expect(ATALHOS_TAREFAS.map((a) => rotuloAtalho(a, null))).toEqual([
      'Pendentes',
      'Em andamento',
      'Aguardando validação',
      'Todos',
    ]);
  });

  it('título e conclusão', () => {
    expect(
      tituloTarefa({
        cliente: { id: 'c', nome: 'Pizzaria Ficticia' },
        produto: { id: 'p', nome: 'Caixa 35x35' },
      }),
    ).toBe('Arte de Caixa 35x35 para Pizzaria Ficticia');
    expect(precisaDaArteParaConcluir({ arteId: null })).toBe(true);
    expect(precisaDaArteParaConcluir({ arteId: 'a' })).toBe(false);
  });
});
