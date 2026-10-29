import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  type ArquivoLocal,
  criarClienteArtes,
  ErroRequisicao,
  errosDaRejeicao,
  inspecionarArquivo,
  montarEnvio,
} from '../../../src/app/plataforma/artes.js';
import { ErroIndisponivel, ErroRecusado } from '../../../src/app/plataforma/cliente.js';

const ID = '3f0c6d2e-8a41-4b5e-9d3a-1c2b3d4e5f60';
const MB = 1024 * 1024;

const PDF = { tipo: 'pdf', mime: 'application/pdf' } as const;
const PNG = { tipo: 'imagem', mime: 'image/png' } as const;

const local = (sobre: Partial<ArquivoLocal> = {}): ArquivoLocal => ({
  caminho: 'C:\\arte.pdf',
  nome: 'arte.pdf',
  tamanho: 1024,
  tipo: PDF,
  ...sobre,
});

const entrada = { produtoId: ID, nome: '', corId: ID, maquinaIds: [ID] };
const abrirBlob = async (_caminho: string, mime: string) => new Blob(['x'], { type: mime });

describe('montarEnvio', () => {
  it('monta o multipart com os campos da API e o PDF com o nome original', async () => {
    const envio = await montarEnvio(entrada, { pdf: local() }, abrirBlob);

    if (!('form' in envio)) throw new Error('esperava o formulário');
    expect(envio.form.get('produtoId')).toBe(ID);
    expect(envio.form.get('nome')).toBe('');
    expect(envio.form.get('corId')).toBe(ID);
    expect(envio.form.getAll('maquinaIds')).toEqual([ID]);
    const pdf = envio.form.get('pdf') as File;
    expect(pdf.name).toBe('arte.pdf');
    expect(pdf.type).toBe('application/pdf');
    expect(envio.form.has('imagem')).toBe(false);
  });

  it('envia PDF e imagem juntos e repete maquinaIds', async () => {
    const outra = '9a0c6d2e-8a41-4b5e-9d3a-1c2b3d4e5f61';
    const envio = await montarEnvio(
      { ...entrada, maquinaIds: [ID, outra] },
      { pdf: local(), imagem: local({ nome: 'arte.png', tipo: PNG }) },
      abrirBlob,
    );

    if (!('form' in envio)) throw new Error('esperava o formulário');
    expect(envio.form.getAll('maquinaIds')).toEqual([ID, outra]);
    expect((envio.form.get('imagem') as File).type).toBe('image/png');
  });

  it('recusa sem arquivo e sem máquina, sem montar o formulário', async () => {
    const envio = await montarEnvio({ ...entrada, maquinaIds: [] }, {}, abrirBlob);

    expect(envio).toEqual({
      erros: {
        maquinaIds: 'Selecione ao menos uma máquina.',
        arquivos: 'Envie ao menos um arquivo.',
      },
    });
  });

  it('recusa PDF de 25 MB + 1 byte e imagem de 10 MB + 1 byte', async () => {
    const pdfGrande = await montarEnvio(
      entrada,
      { pdf: local({ tamanho: 25 * MB + 1 }) },
      abrirBlob,
    );
    const imagemGrande = await montarEnvio(
      entrada,
      { imagem: local({ tipo: PNG, tamanho: 10 * MB + 1 }) },
      abrirBlob,
    );

    expect(pdfGrande).toEqual({ erros: { arquivos: 'O arquivo passa de 25 MB.' } });
    expect(imagemGrande).toEqual({ erros: { arquivos: 'O arquivo passa de 10 MB.' } });
  });

  it('aceita exatamente o limite', async () => {
    const envio = await montarEnvio(entrada, { pdf: local({ tamanho: 25 * MB }) }, abrirBlob);

    expect('form' in envio).toBe(true);
  });

  it('recusa arquivo de tipo trocado (imagem no campo PDF) e tipo desconhecido', async () => {
    const trocado = await montarEnvio(entrada, { pdf: local({ tipo: PNG }) }, abrirBlob);
    const desconhecido = await montarEnvio(entrada, { imagem: local({ tipo: null }) }, abrirBlob);

    expect(trocado).toEqual({ erros: { arquivos: 'O arquivo precisa ser um PDF.' } });
    expect(desconhecido).toEqual({
      erros: { arquivos: 'A imagem precisa ser PNG, JPEG ou WebP.' },
    });
  });
});

describe('inspecionarArquivo', () => {
  let pasta: string;
  beforeEach(async () => {
    pasta = await mkdtemp(path.join(tmpdir(), 'rpa-artes-'));
  });
  afterEach(() => rm(pasta, { recursive: true, force: true }));

  it('detecta o tipo pelos bytes, não pela extensão, e informa o tamanho', async () => {
    const caminho = path.join(pasta, 'falso.png');
    await writeFile(caminho, Buffer.from('%PDF-1.4\n%%EOF'));

    const arquivo = await inspecionarArquivo(caminho);

    expect(arquivo).toMatchObject({ nome: 'falso.png', tamanho: 14, tipo: PDF });
  });

  it('arquivo vazio fica sem tipo; ausente lança erro de disco', async () => {
    const vazio = path.join(pasta, 'vazio.pdf');
    await writeFile(vazio, '');

    expect(await inspecionarArquivo(vazio)).toMatchObject({ tamanho: 0, tipo: null });
    await expect(inspecionarArquivo(path.join(pasta, 'nao-existe.pdf'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });
});

describe('errosDaRejeicao', () => {
  it('leva o 409 ao campo Nome, 413 e 415 a arquivos e 422 ao erro geral', () => {
    expect(errosDaRejeicao(new ErroRequisicao(409, 'conflito', "Já existe uma arte 'A'"))).toEqual({
      nome: "Já existe uma arte 'A'",
    });
    expect(errosDaRejeicao(new ErroRequisicao(413, 'arquivo_grande', 'grande'))).toEqual({
      arquivos: 'grande',
    });
    expect(errosDaRejeicao(new ErroRequisicao(415, 'tipo', 'tipo'))).toEqual({ arquivos: 'tipo' });
    expect(errosDaRejeicao(new ErroRequisicao(422, 'validacao', 'inválido'))).toEqual({
      geral: 'inválido',
    });
  });

  it('deixa subir rede, permissão e erros sem tratamento', () => {
    expect(errosDaRejeicao(new ErroIndisponivel('Sem conexão com o servidor.'))).toBeNull();
    expect(errosDaRejeicao(new ErroRecusado(403, 'sem_permissao', 'Sem permissão'))).toBeNull();
    expect(errosDaRejeicao(new ErroRequisicao(404, 'x', 'x'))).toBeNull();
  });
});

describe('criarClienteArtes', () => {
  const json = (corpo: unknown, status = 200) =>
    new Response(JSON.stringify(corpo), {
      status,
      headers: { 'content-type': 'application/json' },
    });

  function cliente(responder: (url: string, init: RequestInit) => Response) {
    const chamadas: { url: string; init: RequestInit }[] = [];
    const fake = (async (url: string | URL | Request, init?: RequestInit) => {
      chamadas.push({ url: String(url), init: init ?? {} });
      return responder(String(url), init ?? {});
    }) as typeof fetch;
    return {
      chamadas,
      api: criarClienteArtes({
        baseUrl: 'http://api.local/',
        fetch: fake,
        obterAcesso: async () => 'acesso-1',
      }),
    };
  }

  it('lista clientes com busca e cursor na query e o token no cabeçalho', async () => {
    const { api, chamadas } = cliente(() => json({ itens: [], proximoCursor: null }));

    await api.listarClientes('aba', { busca: 'Gráfica Ç', cursor: 'abc' });

    expect(chamadas[0]?.url).toBe(
      'http://api.local/v1/empresas/aba/clientes?busca=Gr%C3%A1fica+%C3%87&cursor=abc',
    );
    expect(chamadas[0]?.init.headers).toEqual({ authorization: 'Bearer acesso-1' });
  });

  it('sem busca nem cursor não envia query', async () => {
    const { api, chamadas } = cliente(() => json({ itens: [], proximoCursor: null }));

    await api.listarClientes('aba', {});

    expect(chamadas[0]?.url).toBe('http://api.local/v1/empresas/aba/clientes');
  });

  it('resposta fora do contrato vira ErroIndisponivel', async () => {
    const { api } = cliente(() => json({ itens: 'x' }));

    await expect(api.listarClientes('aba', {})).rejects.toBeInstanceOf(ErroIndisponivel);
  });

  it('classifica 403, 409 e 500', async () => {
    const status = async (codigo: number) => {
      const { api } = cliente(() =>
        json({ erro: { codigo: 'x', mensagem: 'mensagem da API' } }, codigo),
      );
      return api.cadastrar('aba', ID, new FormData()).catch((e: unknown) => e);
    };

    expect(await status(403)).toBeInstanceOf(ErroRecusado);
    const conflito = await status(409);
    expect(conflito).toBeInstanceOf(ErroRequisicao);
    expect(conflito).toMatchObject({ status: 409, message: 'mensagem da API' });
    expect(await status(500)).toBeInstanceOf(ErroIndisponivel);
  });

  it('rede caída vira "Sem conexão com o servidor."', async () => {
    const api = criarClienteArtes({
      baseUrl: 'http://api.local',
      fetch: (async () => {
        throw new TypeError('fetch failed');
      }) as typeof fetch,
      obterAcesso: async () => 'acesso-1',
    });

    await expect(api.opcoes('aba')).rejects.toThrow('Sem conexão com o servidor.');
  });

  it('o cadastro envia o multipart por POST na rota do cliente', async () => {
    const { api, chamadas } = cliente(() => json({}, 201));
    const form = new FormData();
    form.append('nome', 'x');

    await api.cadastrar('aba', ID, form);

    expect(chamadas[0]?.url).toBe(`http://api.local/v1/empresas/aba/clientes/${ID}/artes`);
    expect(chamadas[0]?.init.method).toBe('POST');
    expect(chamadas[0]?.init.body).toBe(form);
  });
});
