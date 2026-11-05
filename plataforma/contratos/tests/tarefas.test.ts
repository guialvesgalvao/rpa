import { describe, expect, it } from 'vitest';

import {
  EsquemaConsultaTarefas,
  EsquemaNovoComentario,
  precisaDaArteParaConcluir,
  ROTULOS_STATUS_TAREFA,
  STATUS_EM_ANDAMENTO,
  STATUS_TAREFA,
  submenusTarefas,
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

  it('título, conclusão e submenus por perfil', () => {
    expect(
      tituloTarefa({
        cliente: { id: 'c', nome: 'Pizzaria Ficticia' },
        produto: { id: 'p', nome: 'Caixa 35x35' },
      }),
    ).toBe('Arte de Caixa 35x35 para Pizzaria Ficticia');
    expect(precisaDaArteParaConcluir({ arteId: null })).toBe(true);
    expect(precisaDaArteParaConcluir({ arteId: 'a' })).toBe(false);
    expect(submenusTarefas('arte_finalista')).toEqual(['minhas']);
    expect(submenusTarefas('admin')).toEqual(['andamento']);
  });
});
