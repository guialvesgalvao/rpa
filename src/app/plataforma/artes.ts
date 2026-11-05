import { openAsBlob } from 'node:fs';
import { open } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';

import { ErroIndisponivel, ErroRecusado } from './cliente.js';
import {
  type ArteDoProduto,
  type Cliente,
  type ComentarioTarefa,
  detectarTipo,
  type EscopoTarefas,
  EsquemaComentarioTarefa,
  EsquemaEventoTarefa,
  EsquemaTarefa,
  EsquemaTarefaDetalhe,
  type EventoTarefa,
  EsquemaArteDoProduto,
  EsquemaCliente,
  EsquemaErro,
  EsquemaNumerosOp,
  EsquemaOpcao,
  EsquemaPaginaClientes,
  EsquemaProdutoDoCliente,
  type ErrosNovaArte,
  LIMITES,
  type Opcao,
  type PaginaClientes,
  type ProdutoDoCliente,
  type StatusTarefa,
  type Tarefa,
  type TarefaDetalhe,
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

/** Imagem de uma arte, com o tipo conferido pelos primeiros bytes. */
export type ImagemArte = { mime: TipoDetectado['mime']; bytes: Uint8Array };

export type ClienteArtes = {
  listarClientes(empresa: string, consulta: ConsultaClientes): Promise<PaginaClientes>;
  obterCliente(empresa: string, id: string): Promise<Cliente>;
  /** Cliente com o CNPJ exato (14 dígitos, com ou sem máscara); `null` se não houver. */
  clientePorCnpj(empresa: string, cnpj: string): Promise<Cliente | null>;
  produtosDoCliente(empresa: string, id: string): Promise<ProdutoDoCliente[]>;
  /** Artes do produto para o cliente, da mais nova para a mais antiga. */
  artesDoProduto(empresa: string, clienteId: string, produtoId: string): Promise<ArteDoProduto[]>;
  imagemDaArte(empresa: string, arteId: string): Promise<ImagemArte>;
  opcoes(empresa: string): Promise<OpcoesArte>;
  cadastrar(empresa: string, clienteId: string, form: FormData): Promise<void>;
  /** Reserva `quantidade` números de OP consecutivos (só admin). */
  reservarNumerosOp(empresa: string, quantidade: number): Promise<number[]>;
  /** Tarefa de desenvolvimento de arte do produto (catálogo) para o cliente. */
  criarTarefa(empresa: string, clienteId: string, produtoId: string): Promise<Tarefa>;
  listarTarefas(empresa: string, consulta: ConsultaTarefasApp): Promise<Tarefa[]>;
  obterTarefa(empresa: string, id: string): Promise<TarefaDetalhe>;
  mudarStatusTarefa(empresa: string, id: string, status: StatusTarefa): Promise<Tarefa>;
  /** Cadastra a arte (multipart, como `cadastrar`) e conclui a tarefa. */
  concluirTarefa(empresa: string, id: string, form: FormData): Promise<Tarefa>;
  comentarTarefa(empresa: string, id: string, texto: string): Promise<ComentarioTarefa>;
  historicoTarefa(empresa: string, id: string): Promise<EventoTarefa[]>;
};

export type ConsultaTarefasApp = { escopo: EscopoTarefas; status?: StatusTarefa };

/** Só os dígitos do CNPJ; `null` se não sobrarem 14. */
export function normalizarCnpj(cnpj: string): string | null {
  const digitos = cnpj.replace(/\D/g, '');
  return digitos.length === 14 ? digitos : null;
}

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
    metodo: 'GET' | 'POST' | 'PATCH',
    caminho: string,
    opcoes: { corpo?: FormData; json?: unknown; timeout?: number } = {},
  ): Promise<Response> {
    const acesso = await obterAcesso();
    const headers: Record<string, string> = { authorization: `Bearer ${acesso}` };
    if (opcoes.json !== undefined) headers['content-type'] = 'application/json';
    let resposta: Response;
    try {
      resposta = await buscar(`${base}${caminho}`, {
        method: metodo,
        headers,
        body: opcoes.json !== undefined ? JSON.stringify(opcoes.json) : opcoes.corpo,
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
    async clientePorCnpj(empresa, cnpj) {
      const digitos = normalizarCnpj(cnpj);
      if (!digitos) return null;
      // A busca casa por trecho; com os 14 dígitos, só o próprio CNPJ casa, e a 1ª página basta.
      const params = new URLSearchParams({ busca: digitos });
      const resposta = await chamar('GET', rota(empresa, `/clientes?${params}`));
      const { itens } = await lerJson(resposta, EsquemaPaginaClientes);
      return itens.find((cliente) => cliente.cnpj === digitos) ?? null;
    },
    async produtosDoCliente(empresa, id) {
      const resposta = await chamar(
        'GET',
        rota(empresa, `/clientes/${encodeURIComponent(id)}/produtos`),
      );
      return lerJson(resposta, z.array(EsquemaProdutoDoCliente));
    },
    async artesDoProduto(empresa, clienteId, produtoId) {
      const resposta = await chamar(
        'GET',
        rota(
          empresa,
          `/clientes/${encodeURIComponent(clienteId)}/produtos/${encodeURIComponent(produtoId)}/artes`,
        ),
      );
      return lerJson(resposta, z.array(EsquemaArteDoProduto));
    },
    async imagemDaArte(empresa, arteId) {
      const resposta = await chamar(
        'GET',
        rota(empresa, `/artes/${encodeURIComponent(arteId)}/imagem`),
      );
      let bytes: Uint8Array;
      try {
        bytes = new Uint8Array(await resposta.arrayBuffer());
      } catch (erro) {
        throw new ErroIndisponivel('Sem conexão com o servidor.', { cause: erro });
      }
      // O tipo vem dos bytes, não do cabeçalho: o PDF só embute PNG, JPEG ou WebP.
      const tipo = detectarTipo(bytes.subarray(0, BYTES_ASSINATURA));
      if (tipo?.tipo !== 'imagem' || bytes.length > LIMITES.imagemBytes) {
        throw new ErroIndisponivel('Resposta do servidor fora do contrato.');
      }
      return { mime: tipo.mime, bytes };
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
    async reservarNumerosOp(empresa, quantidade) {
      const resposta = await chamar('POST', rota(empresa, '/op/numeros'), {
        json: { quantidade },
      });
      return (await lerJson(resposta, EsquemaNumerosOp)).numeros;
    },
    async criarTarefa(empresa, clienteId, produtoId) {
      const caminho = `/clientes/${encodeURIComponent(clienteId)}/produtos/${encodeURIComponent(produtoId)}/tarefas`;
      return lerJson(await chamar('POST', rota(empresa, caminho)), EsquemaTarefa);
    },
    async listarTarefas(empresa, { escopo, status }) {
      const params = new URLSearchParams({ escopo });
      if (status) params.set('status', status);
      const resposta = await chamar('GET', rota(empresa, `/tarefas?${params}`));
      return lerJson(resposta, z.array(EsquemaTarefa));
    },
    async obterTarefa(empresa, id) {
      const resposta = await chamar('GET', rota(empresa, `/tarefas/${encodeURIComponent(id)}`));
      return lerJson(resposta, EsquemaTarefaDetalhe);
    },
    async mudarStatusTarefa(empresa, id, status) {
      const resposta = await chamar(
        'PATCH',
        rota(empresa, `/tarefas/${encodeURIComponent(id)}/status`),
        { json: { status } },
      );
      return lerJson(resposta, EsquemaTarefa);
    },
    async concluirTarefa(empresa, id, form) {
      const resposta = await chamar(
        'POST',
        rota(empresa, `/tarefas/${encodeURIComponent(id)}/concluir`),
        { corpo: form, timeout: timeoutEnvioMs },
      );
      return lerJson(resposta, EsquemaTarefa);
    },
    async comentarTarefa(empresa, id, texto) {
      const resposta = await chamar(
        'POST',
        rota(empresa, `/tarefas/${encodeURIComponent(id)}/comentarios`),
        { json: { texto } },
      );
      return lerJson(resposta, EsquemaComentarioTarefa);
    },
    async historicoTarefa(empresa, id) {
      const resposta = await chamar(
        'GET',
        rota(empresa, `/tarefas/${encodeURIComponent(id)}/historico`),
      );
      return lerJson(resposta, z.array(EsquemaEventoTarefa));
    },
  };
}

/** Produto com o código (SKU) do Bling, sem espaços nas pontas; código vazio não casa. */
export function produtoDoCodigo<T extends { codigo: string | null }>(
  produtos: readonly T[],
  codigo: string,
): T | undefined {
  const alvo = codigo.trim();
  return alvo ? produtos.find((p) => p.codigo?.trim() === alvo) : undefined;
}

/** Produto do cliente que casou com o item do pedido (`null` se nenhum) e as artes dele. */
export type ArtesDoItem = { produtoId: string | null; artes: ArteDoProduto[] };

/**
 * Artes de um item do pedido: casa o código (SKU) do Bling com os produtos do cliente que têm arte.
 * Sem produto com esse código, o item fica sem arte (a OP não bloqueia).
 */
export async function artesDoItem(
  api: Pick<ClienteArtes, 'produtosDoCliente' | 'artesDoProduto'>,
  empresa: string,
  clienteId: string,
  codigo: string,
): Promise<ArtesDoItem> {
  const produtos = codigo.trim() ? await api.produtosDoCliente(empresa, clienteId) : [];
  const produto = produtoDoCodigo(produtos, codigo);
  if (!produto) return { produtoId: null, artes: [] };
  return { produtoId: produto.id, artes: await api.artesDoProduto(empresa, clienteId, produto.id) };
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
      // Nome repetido vai ao lado do Nome; os outros conflitos (ex.: tarefa já com arte), no geral.
      return erro.codigo === 'arte_duplicada' ? { nome: erro.message } : { geral: erro.message };
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
