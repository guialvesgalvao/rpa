import { describe, expect, it } from 'vitest';

import {
  criarClienteArtes,
  ErroRequisicao,
  errosDaRejeicao,
} from '../../../src/app/plataforma/artes.js';

// Dados sintéticos: ids e nomes fictícios.
const TAREFA = '66666666-6666-4666-8666-666666666666';
const CLIENTE = '3f0c6d2e-8a41-4b5e-9d3a-1c2b3d4e5f60';
const PRODUTO = '11111111-1111-4111-8111-111111111111';
const USUARIO = '77777777-7777-4777-8777-777777777777';

const tarefa = (extra: Record<string, unknown> = {}) => ({
  id: TAREFA,
  cliente: { id: CLIENTE, nome: 'Pizzaria Ficticia' },
  produto: { id: PRODUTO, nome: 'Caixa 35x35' },
  responsavel: { id: USUARIO, nome: 'Ana Ficticia' },
  status: 'nao_iniciada',
  arteId: null,
  criadoEm: '2026-11-05T12:00:00.000Z',
  atualizadoEm: '2026-11-05T12:00:00.000Z',
  ...extra,
});

const json = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { 'content-type': 'application/json' } });

type Chamada = { url: string; metodo?: string; corpo?: unknown };

function api(responder: (url: string) => Response) {
  const chamadas: Chamada[] = [];
  const fake = (async (url: string | URL | Request, init?: RequestInit) => {
    chamadas.push({ url: String(url), metodo: init?.method, corpo: init?.body });
    return responder(String(url));
  }) as typeof fetch;
  return {
    chamadas,
    cliente: criarClienteArtes({
      baseUrl: 'http://api.local',
      fetch: fake,
      obterAcesso: async () => 'acesso-1',
    }),
  };
}

describe('tarefas no cliente da API', () => {
  it('cria pela rota do produto do cliente', async () => {
    const { cliente, chamadas } = api(() => json(tarefa(), 201));
    expect((await cliente.criarTarefa('roma', CLIENTE, PRODUTO)).id).toBe(TAREFA);
    expect(chamadas).toEqual([
      {
        url: `http://api.local/v1/empresas/roma/clientes/${CLIENTE}/produtos/${PRODUTO}/tarefas`,
        metodo: 'POST',
        corpo: undefined,
      },
    ]);
  });

  it('usuários: lista, cria, edita, define permissões e exclui pelas rotas da empresa', async () => {
    const detalhe = {
      id: USUARIO,
      nome: 'Ana Ficticia',
      email: 'ana@exemplo.com',
      area: 'producao',
      ativo: true,
      empresas: [{ slug: 'roma', permissoes: ['artes'] }],
      criadoEm: '2026-11-05T12:00:00.000Z',
    };
    const base = 'http://api.local/v1/empresas/roma/usuarios';
    const { cliente, chamadas } = api((url) =>
      url === base ? json([detalhe]) : new Response(null, { status: 204 }),
    );
    expect(await cliente.listarUsuarios('roma')).toEqual([detalhe]);
    await cliente.excluirUsuario('roma', USUARIO);
    expect(chamadas).toMatchObject([
      { url: base, metodo: 'GET' },
      { url: `${base}/${USUARIO}`, metodo: 'DELETE' },
    ]);

    const escrita = api(() => json(detalhe, 201));
    const novo = {
      nome: 'Ana Ficticia',
      email: 'ana@exemplo.com',
      area: 'producao' as const,
      empresas: ['roma'],
      senha: 'senha-inicial-123',
      permissoes: { roma: ['artes' as const] },
    };
    expect(await escrita.cliente.criarUsuario('roma', novo)).toEqual(detalhe);
    await escrita.cliente.editarUsuario('roma', USUARIO, { nome: 'Outro Nome' });
    await escrita.cliente.definirPermissoesUsuario('roma', USUARIO, ['ops']);
    expect(escrita.chamadas).toMatchObject([
      { url: base, metodo: 'POST' },
      { url: `${base}/${USUARIO}`, metodo: 'PATCH' },
      { url: `${base}/${USUARIO}/permissoes`, metodo: 'PATCH' },
    ]);
    expect(JSON.parse(String(escrita.chamadas[0]?.corpo))).toEqual(novo);
    expect(JSON.parse(String(escrita.chamadas[1]?.corpo))).toEqual({ nome: 'Outro Nome' });
    expect(JSON.parse(String(escrita.chamadas[2]?.corpo))).toEqual({ permissoes: ['ops'] });
  });

  it('comentário com anexos (multipart) e download do anexo', async () => {
    const comentario = {
      id: TAREFA,
      autor: { id: USUARIO, nome: 'Ana Ficticia' },
      texto: '',
      anexos: [{ id: PRODUTO, nome: 'a.pdf', tipoMime: 'application/pdf', tamanho: 3 }],
      criadoEm: '2026-11-05T12:00:00.000Z',
    };
    const { cliente, chamadas } = api((url) =>
      url.includes('/anexos/') ? new Response(new Uint8Array([1, 2, 3])) : json(comentario, 201),
    );
    const form = new FormData();
    form.append('texto', '');
    expect((await cliente.comentarTarefaComAnexos('roma', TAREFA, form)).anexos).toHaveLength(1);
    expect(chamadas[0]).toMatchObject({
      url: `http://api.local/v1/empresas/roma/tarefas/${TAREFA}/comentarios`,
      metodo: 'POST',
      corpo: form,
    });
    const bytes = await cliente.baixarAnexo('roma', TAREFA, CLIENTE, PRODUTO);
    expect([...bytes]).toEqual([1, 2, 3]);
    expect(chamadas[1]?.url).toBe(
      `http://api.local/v1/empresas/roma/tarefas/${TAREFA}/comentarios/${CLIENTE}/anexos/${PRODUTO}`,
    );
  });

  it('responsável automático: lê e grava pela rota da empresa', async () => {
    const config = { responsavelId: USUARIO, elegiveis: [{ id: USUARIO, nome: 'Ana Ficticia' }] };
    const { cliente, chamadas } = api(() => json(config));
    expect(await cliente.obterResponsavelAutomatico('roma')).toEqual(config);
    expect(await cliente.definirResponsavelAutomatico('roma', null)).toEqual(config);
    const url = 'http://api.local/v1/empresas/roma/tarefas/responsavel-automatico';
    expect(chamadas.map((c) => [c.url, c.metodo])).toEqual([
      [url, 'GET'],
      [url, 'PUT'],
    ]);
    expect(JSON.parse(String(chamadas[1]?.corpo))).toEqual({ responsavelId: null });
  });

  it('contagem pela rota dos atalhos', async () => {
    const contagem = { nao_iniciada: 2, em_desenvolvimento: 1, aguardando_cliente: 0 };
    const { cliente, chamadas } = api(() => json(contagem));
    expect(await cliente.contagemTarefas('roma')).toEqual(contagem);
    expect(chamadas).toEqual([
      { url: 'http://api.local/v1/empresas/roma/tarefas/contagem', metodo: 'GET', corpo: undefined },
    ]);
  });

  it('contagem com resposta fora do contrato: erro', async () => {
    const { cliente } = api(() => json({ nao_iniciada: -1 }));
    await expect(cliente.contagemTarefas('roma')).rejects.toThrow();
  });

  it('lista com escopo e status na consulta', async () => {
    const { cliente, chamadas } = api(() => json([tarefa()]));
    await cliente.listarTarefas('roma', { escopo: 'andamento' });
    await cliente.listarTarefas('roma', { escopo: 'todas', status: 'cancelada' });
    expect(chamadas.map((c) => c.url)).toEqual([
      'http://api.local/v1/empresas/roma/tarefas?escopo=andamento',
      'http://api.local/v1/empresas/roma/tarefas?escopo=todas&status=cancelada',
    ]);
  });

  it('muda o status com PATCH e JSON', async () => {
    const { cliente, chamadas } = api(() => json(tarefa({ status: 'em_desenvolvimento' })));
    const atualizada = await cliente.mudarStatusTarefa('roma', TAREFA, 'em_desenvolvimento');
    expect(atualizada.status).toBe('em_desenvolvimento');
    expect(chamadas[0]).toEqual({
      url: `http://api.local/v1/empresas/roma/tarefas/${TAREFA}/status`,
      metodo: 'PATCH',
      corpo: JSON.stringify({ status: 'em_desenvolvimento' }),
    });
  });

  it('conclui enviando o multipart da arte', async () => {
    const { cliente, chamadas } = api(() => json(tarefa({ status: 'concluida', arteId: USUARIO })));
    const form = new FormData();
    form.append('corId', 'x');
    expect((await cliente.concluirTarefa('roma', TAREFA, form)).status).toBe('concluida');
    expect(chamadas[0]?.url).toBe(`http://api.local/v1/empresas/roma/tarefas/${TAREFA}/concluir`);
    expect(chamadas[0]?.corpo).toBe(form);
  });

  it('lê detalhe, comentário e histórico pelo contrato', async () => {
    const comentario = {
      id: USUARIO,
      autor: { id: USUARIO, nome: 'Ana Ficticia' },
      texto: 'Fundo azul',
      criadoEm: '2026-11-05T12:00:00.000Z',
    };
    const evento = {
      id: USUARIO,
      statusAnterior: null,
      statusNovo: 'nao_iniciada',
      autor: null,
      criadoEm: '2026-11-05T12:00:00.000Z',
    };
    const { cliente } = api((url) => {
      if (url.endsWith('/comentarios')) return json(comentario, 201);
      if (url.endsWith('/historico')) return json([evento]);
      return json({ ...tarefa(), comentarios: [comentario] });
    });
    expect((await cliente.obterTarefa('roma', TAREFA)).comentarios).toHaveLength(1);
    expect((await cliente.comentarTarefa('roma', TAREFA, 'Fundo azul')).texto).toBe('Fundo azul');
    expect(await cliente.historicoTarefa('roma', TAREFA)).toEqual([evento]);
  });

  it('resposta fora do contrato vira indisponível', async () => {
    const { cliente } = api(() => json({ id: 'x' }));
    await expect(cliente.obterTarefa('roma', TAREFA)).rejects.toThrow('fora do contrato');
  });
});

describe('errosDaRejeicao no 409', () => {
  it('nome repetido vai ao lado do Nome; outros conflitos, no geral', () => {
    expect(errosDaRejeicao(new ErroRequisicao(409, 'arte_duplicada', 'Já existe'))).toEqual({
      nome: 'Já existe',
    });
    expect(errosDaRejeicao(new ErroRequisicao(409, 'tarefa_com_arte', 'Já tem arte'))).toEqual({
      geral: 'Já tem arte',
    });
  });
});
