import { openAsBlob } from 'node:fs';
import { open } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';

import { ErroIndisponivel, ErroRecusado } from './cliente.js';
import {
  type Cliente,
  detectarTipo,
  EsquemaCliente,
  EsquemaErro,
  EsquemaOpcao,
  EsquemaPaginaClientes,
  EsquemaProdutoDoCliente,
  type ErrosNovaArte,
  type Opcao,
  type PaginaClientes,
  type ProdutoDoCliente,
  type TipoDetectado,
  validarNovaArte,
} from './contratos.js';

/** 4xx que a tela precisa tratar (409 nome repetido, 413 arquivo grande, 415 tipo, 422 validação). */
export class ErroRequisicao extends Error {
  override name = 'ErroRequisicao';

  constructor(
    readonly status: number,
    readonly codigo: string,
    mensagem: string,
  ) {
    super(mensagem);
  }
}

export type OpcoesArte = { produtos: Opcao[]; cores: Opcao[]; maquinas: Opcao[] };

export type ConsultaClientes = { busca?: string; cursor?: string };

export type DepsClienteArtes = {
  baseUrl: string;
  fetch: typeof fetch;
  /** Token de acesso válido; lança se a sessão não permite chamar a API. */
  obterAcesso: () => Promise<string>;
  /** Tempo máximo das leituras, em ms. */
  timeoutMs?: number;
  /** Tempo máximo do envio de uma arte (arquivos de até 25 MB), em ms. */
  timeoutEnvioMs?: number;
};

export type ClienteArtes = {
  listarClientes(empresa: string, consulta: ConsultaClientes): Promise<PaginaClientes>;
  obterCliente(empresa: string, id: string): Promise<Cliente>;
  produtosDoCliente(empresa: string, id: string): Promise<ProdutoDoCliente[]>;
  opcoes(empresa: string): Promise<OpcoesArte>;
  cadastrar(empresa: string, clienteId: string, form: FormData): Promise<void>;
};

const TIMEOUT_PADRAO_MS = 15_000;
// O Railway aceita uploads de até 5 minutos.
const TIMEOUT_ENVIO_PADRAO_MS = 5 * 60_000;

type Esquema<T> = { safeParse(dado: unknown): { success: true; data: T } | { success: false } };

export function criarClienteArtes({
  baseUrl,
  fetch: buscar,
  obterAcesso,
  timeoutMs = TIMEOUT_PADRAO_MS,
  timeoutEnvioMs = TIMEOUT_ENVIO_PADRAO_MS,
}: DepsClienteArtes): ClienteArtes {
  const base = baseUrl.replace(/\/+$/, '');

  async function chamar(
    metodo: 'GET' | 'POST',
    caminho: string,
    opcoes: { corpo?: FormData; timeout?: number } = {},
  ): Promise<Response> {
    const acesso = await obterAcesso();
    let resposta: Response;
    try {
      resposta = await buscar(`${base}${caminho}`, {
        method: metodo,
        headers: { authorization: `Bearer ${acesso}` },
        body: opcoes.corpo,
        signal: AbortSignal.timeout(opcoes.timeout ?? timeoutMs),
      });
    } catch (erro) {
      throw new ErroIndisponivel('Sem conexão com o servidor.', { cause: erro });
    }
    if (resposta.ok) return resposta;

    const status = resposta.status;
    if (status >= 500 || status < 400 || status === 408 || status === 429) {
      throw new ErroIndisponivel(`Servidor indisponível (HTTP ${status}).`);
    }
    const detalhe = EsquemaErro.safeParse(await resposta.json().catch(() => undefined));
    const codigo = detalhe.success ? detalhe.data.erro.codigo : 'recusado';
    const mensagem = detalhe.success ? detalhe.data.erro.mensagem : 'Requisição recusada.';
    if (status === 401 || status === 403) throw new ErroRecusado(status, codigo, mensagem);
    throw new ErroRequisicao(status, codigo, mensagem);
  }

  async function lerJson<T>(resposta: Response, esquema: Esquema<T>): Promise<T> {
    const dado: unknown = await resposta.json().catch(() => undefined);
    const resultado = esquema.safeParse(dado);
    if (!resultado.success) throw new ErroIndisponivel('Resposta do servidor fora do contrato.');
    return resultado.data;
  }

  const rota = (empresa: string, resto: string) =>
    `/v1/empresas/${encodeURIComponent(empresa)}${resto}`;
  const listaDeOpcoes = z.array(EsquemaOpcao);

  return {
    async listarClientes(empresa, { busca, cursor }) {
      const params = new URLSearchParams();
      if (busca) params.set('busca', busca);
      if (cursor) params.set('cursor', cursor);
      const consulta = params.size ? `?${params}` : '';
      const resposta = await chamar('GET', rota(empresa, `/clientes${consulta}`));
      return lerJson(resposta, EsquemaPaginaClientes);
    },
    async obterCliente(empresa, id) {
      const resposta = await chamar('GET', rota(empresa, `/clientes/${encodeURIComponent(id)}`));
      return lerJson(resposta, EsquemaCliente);
    },
    async produtosDoCliente(empresa, id) {
      const resposta = await chamar(
        'GET',
        rota(empresa, `/clientes/${encodeURIComponent(id)}/produtos`),
      );
      return lerJson(resposta, z.array(EsquemaProdutoDoCliente));
    },
    async opcoes(empresa) {
      const [produtos, cores, maquinas] = await Promise.all([
        chamar('GET', rota(empresa, '/produtos')),
        chamar('GET', '/v1/cores'),
        chamar('GET', '/v1/maquinas'),
      ]);
      return {
        produtos: await lerJson(produtos, listaDeOpcoes),
        cores: await lerJson(cores, listaDeOpcoes),
        maquinas: await lerJson(maquinas, listaDeOpcoes),
      };
    },
    async cadastrar(empresa, clienteId, form) {
      await chamar('POST', rota(empresa, `/clientes/${encodeURIComponent(clienteId)}/artes`), {
        corpo: form,
        timeout: timeoutEnvioMs,
      });
    },
  };
}

/** Arquivo escolhido na janela: só o main guarda o caminho; a tela recebe nome, tamanho e tipo. */
export type ArquivoLocal = {
  caminho: string;
  nome: string;
  tamanho: number;
  tipo: TipoDetectado | null;
};

const BYTES_ASSINATURA = 16;

/** Tamanho e tipo (pela assinatura dos primeiros bytes, nunca pela extensão) de um arquivo local. */
export async function inspecionarArquivo(caminho: string): Promise<ArquivoLocal> {
  const arquivo = await open(caminho, 'r');
  try {
    const { size } = await arquivo.stat();
    const cabecalho = Buffer.alloc(BYTES_ASSINATURA);
    const { bytesRead } = await arquivo.read(cabecalho, 0, BYTES_ASSINATURA, 0);
    return {
      caminho,
      nome: path.basename(caminho),
      tamanho: size,
      tipo: detectarTipo(cabecalho.subarray(0, bytesRead)),
    };
  } finally {
    await arquivo.close();
  }
}

export type EntradaCadastro = {
  produtoId: string;
  nome?: string;
  corId: string;
  maquinaIds: string[];
};

export type ArquivosCadastro = { pdf?: ArquivoLocal; imagem?: ArquivoLocal };

/** Erros por campo (mesmos nomes de `validarNovaArte`) e, à parte, os que não pertencem a um campo. */
export type ErrosCadastro = ErrosNovaArte & { geral?: string };

export type AbrirBlob = (caminho: string, mime: string) => Promise<Blob>;

const abrirBlobPadrao: AbrirBlob = (caminho, mime) => openAsBlob(caminho, { type: mime });

/**
 * Valida com as regras de `contratos` (as mesmas do site e da API) e monta o multipart que a API espera.
 * O conteúdo dos arquivos não passa pela memória do app: `openAsBlob` lê do disco no envio.
 */
export async function montarEnvio(
  entrada: EntradaCadastro,
  arquivos: ArquivosCadastro,
  abrirBlob: AbrirBlob = abrirBlobPadrao,
): Promise<{ erros: ErrosNovaArte } | { form: FormData }> {
  const resumo = (arquivo?: ArquivoLocal) =>
    arquivo && { tamanho: arquivo.tamanho, tipo: arquivo.tipo?.tipo ?? null };
  const erros = validarNovaArte({
    ...entrada,
    pdf: resumo(arquivos.pdf),
    imagem: resumo(arquivos.imagem),
  });
  if (Object.keys(erros).length > 0) return { erros };

  const form = new FormData();
  form.append('produtoId', entrada.produtoId);
  form.append('nome', entrada.nome ?? '');
  form.append('corId', entrada.corId);
  for (const id of entrada.maquinaIds) form.append('maquinaIds', id);
  for (const campo of ['pdf', 'imagem'] as const) {
    const arquivo = arquivos[campo];
    // `validarNovaArte` garante o tipo detectado de cada arquivo enviado.
    if (arquivo?.tipo) {
      form.append(campo, await abrirBlob(arquivo.caminho, arquivo.tipo.mime), arquivo.nome);
    }
  }
  return { form };
}

/**
 * Rejeições da API que a tela mostra ao lado do campo (409 → Nome; 413/415 → arquivos; 422/400 → geral).
 * Qualquer outro erro (rede, permissão, servidor) volta `null` e segue como exceção.
 */
export function errosDaRejeicao(erro: unknown): ErrosCadastro | null {
  if (!(erro instanceof ErroRequisicao)) return null;
  switch (erro.status) {
    case 409:
      return { nome: erro.message };
    case 413:
    case 415:
      return { arquivos: erro.message };
    case 400:
    case 422:
      return { geral: erro.message };
    default:
      return null;
  }
}
