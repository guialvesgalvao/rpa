import { describe, expect, it } from 'vitest';

import { criarClienteBling } from '../../src/bling/cliente.js';
import {
  AVISO_SEM_TIPO_CLIENTE,
  avisoDetalheAusente,
  type ProgressoSincronizacao,
  sincronizarBling,
} from '../../src/bling/sincronizacao.js';

// Dados sintéticos no formato da API v3 do Bling (com campos extras que devem ser descartados).
type Contato = { id: number; nome: string; situacao: string; numeroDocumento?: string };
type Detalhe = {
  id: number;
  nome: string;
  fantasia?: string;
  tipo?: string;
  numeroDocumento?: string;
};

type Bling = {
  produtos: object[];
  tipos: { id: number; descricao: string }[];
  contatos: Contato[];
  detalhes: Record<number, Detalhe>;
};

const json = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { 'content-type': 'application/json' } });

function blingFalso(dados: Bling, aoChamar: (url: URL) => void = () => {}) {
  const chamadas: { url: URL; metodo: string | undefined }[] = [];
  const fake = (async (entrada: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(entrada));
    chamadas.push({ url, metodo: init?.method });
    aoChamar(url);
    const caminho = url.pathname.replace('/Api/v3', '');
    const pagina = Number(url.searchParams.get('pagina'));
    const limite = Number(url.searchParams.get('limite'));
    const fatia = <T>(lista: T[]) => lista.slice((pagina - 1) * limite, pagina * limite);
    if (caminho === '/produtos') return json({ data: fatia(dados.produtos) });
    if (caminho === '/contatos/tipos') return json({ data: dados.tipos });
    if (caminho === '/contatos') return json({ data: fatia(dados.contatos) });
    const detalhe = dados.detalhes[Number(caminho.split('/').at(-1))];
    return detalhe
      ? json({ data: { ...detalhe, email: 'nao-deve-sair@exemplo.com', situacao: 'A' } })
      : json({ error: { type: 'RESOURCE_NOT_FOUND' } }, 404);
  }) as typeof fetch;
  const cliente = criarClienteBling({ fetch: fake, esperar: async () => {} });
  return { cliente, chamadas };
}

const acesso = async () => 'acesso-ficticio';

const produto = (id: number, extras: object = {}) => ({
  id,
  nome: `Produto ${id}`,
  codigo: `SKU${id}`,
  formato: 'S',
  situacao: 'A',
  preco: 10,
  idProdutoPai: 0,
  ...extras,
});

const BASE: Bling = {
  produtos: [
    produto(1),
    produto(2, { codigo: '', idProdutoPai: 1, formato: 'V' }),
    produto(3, { codigo: null }),
  ],
  tipos: [
    { id: 10, descricao: 'Fornecedor' },
    { id: 11, descricao: ' CLIENTE ' },
  ],
  contatos: [
    { id: 100, nome: 'Empresa Fictícia A', situacao: 'A', numeroDocumento: '11.222.333/0001-81' },
    { id: 101, nome: 'Empresa Fictícia Inativa', situacao: 'I' },
    { id: 102, nome: 'Pessoa Fictícia', situacao: 'A', numeroDocumento: '' },
  ],
  detalhes: {
    100: {
      id: 100,
      nome: 'Empresa Fictícia A Ltda',
      fantasia: 'Fictícia A',
      tipo: 'J',
      numeroDocumento: '11.222.333/0001-81',
    },
    102: {
      id: 102,
      nome: 'Pessoa Fictícia',
      fantasia: '',
      tipo: 'F',
      numeroDocumento: '123.456.789-09',
    },
  },
};

describe('sincronizarBling', () => {
  it('mapeia produtos ativos', async () => {
    const { cliente, chamadas } = blingFalso(BASE);
    const { produtos } = await sincronizarBling(cliente, { acesso });

    expect(produtos).toEqual([
      { idBling: 1, codigo: 'SKU1', nome: 'Produto 1', formato: 'S', idProdutoPai: null },
      { idBling: 2, codigo: null, nome: 'Produto 2', formato: 'V', idProdutoPai: 1 },
      { idBling: 3, codigo: null, nome: 'Produto 3', formato: 'S', idProdutoPai: null },
    ]);
    expect(chamadas[0]?.url.searchParams.get('criterio')).toBe('2');
  });

  it('lê os contatos ativos do tipo Cliente com o detalhe de cada um', async () => {
    const { cliente, chamadas } = blingFalso(BASE);
    const { clientes, avisos } = await sincronizarBling(cliente, { acesso });

    expect(clientes).toEqual([
      {
        idBling: 100,
        nome: 'Empresa Fictícia A Ltda',
        fantasia: 'Fictícia A',
        tipoPessoa: 'J',
        documento: '11222333000181',
      },
      {
        idBling: 102,
        nome: 'Pessoa Fictícia',
        fantasia: null,
        tipoPessoa: 'F',
        documento: '12345678909',
      },
    ]);
    expect(avisos).toEqual([]);
    expect(JSON.stringify(clientes)).not.toContain('nao-deve-sair');

    const listagem = chamadas.find((c) => c.url.pathname.endsWith('/contatos'));
    expect(listagem?.url.searchParams.get('criterio')).toBe('1');
    expect(listagem?.url.searchParams.get('idTipoContato')).toBe('11');
    const detalhes = chamadas.filter((c) => /\/contatos\/\d+$/.test(c.url.pathname));
    expect(detalhes.map((c) => c.url.pathname.split('/').at(-1))).toEqual(['100', '102']);
  });

  it('só faz GET no Bling', async () => {
    const { cliente, chamadas } = blingFalso(BASE);
    await sincronizarBling(cliente, { acesso });
    expect(chamadas.length).toBeGreaterThan(0);
    expect(chamadas.every((c) => c.metodo === 'GET')).toBe(true);
  });

  it('sem o tipo Cliente, lê todos os contatos ativos e avisa', async () => {
    const { cliente, chamadas } = blingFalso({
      ...BASE,
      tipos: [{ id: 10, descricao: 'Fornecedor' }],
    });
    const { clientes, avisos } = await sincronizarBling(cliente, { acesso });

    expect(clientes.map((c) => c.idBling)).toEqual([100, 102]);
    expect(avisos).toEqual([AVISO_SEM_TIPO_CLIENTE]);
    const listagem = chamadas.find((c) => c.url.pathname.endsWith('/contatos'));
    expect(listagem?.url.searchParams.has('idTipoContato')).toBe(false);
  });

  it('aceita o tipo Cliente com acento e outra caixa', async () => {
    const { cliente } = blingFalso({ ...BASE, tipos: [{ id: 12, descricao: 'Clienté' }] });
    expect((await sincronizarBling(cliente, { acesso })).avisos).toEqual([]);
  });

  it('detalhe 404 vira aviso e o cliente fica com os dados da listagem', async () => {
    const { cliente } = blingFalso({ ...BASE, detalhes: { 102: BASE.detalhes[102]! } });
    const { clientes, avisos } = await sincronizarBling(cliente, { acesso });

    expect(clientes[0]).toEqual({
      idBling: 100,
      nome: 'Empresa Fictícia A',
      fantasia: null,
      tipoPessoa: null,
      documento: '11222333000181',
    });
    expect(avisos).toEqual([avisoDetalheAusente(100)]);
  });

  it('informa o progresso nas três etapas, com o total dos detalhes', async () => {
    const produtos = Array.from({ length: 150 }, (_, i) => produto(i + 1));
    const { cliente } = blingFalso({ ...BASE, produtos });
    const progresso: ProgressoSincronizacao[] = [];
    await sincronizarBling(cliente, { acesso, aoProgredir: (p) => progresso.push(p) });

    expect(progresso).toEqual([
      { etapa: 'produtos', lidos: 0, total: null },
      { etapa: 'produtos', lidos: 100, total: null },
      { etapa: 'produtos', lidos: 150, total: null },
      { etapa: 'clientes', lidos: 0, total: null },
      { etapa: 'clientes', lidos: 3, total: null },
      { etapa: 'detalhes', lidos: 0, total: 2 },
      { etapa: 'detalhes', lidos: 1, total: 2 },
      { etapa: 'detalhes', lidos: 2, total: 2 },
    ]);
  });

  it('para entre chamadas quando o sinal é abortado', async () => {
    const controle = new AbortController();
    const { cliente, chamadas } = blingFalso(BASE, (url) => {
      if (url.pathname.endsWith('/contatos/100')) controle.abort();
    });

    await expect(
      sincronizarBling(cliente, { acesso, sinal: controle.signal }),
    ).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(chamadas.at(-1)?.url.pathname).toMatch(/\/contatos\/100$/);
  });

  it('erros do Bling fora o 404 do detalhe interrompem a leitura', async () => {
    const { cliente } = blingFalso({ ...BASE, tipos: 'quebrado' as never });
    await expect(sincronizarBling(cliente, { acesso })).rejects.toMatchObject({
      tipo: 'resposta_invalida',
    });
  });
});
