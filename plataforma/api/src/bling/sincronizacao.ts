import type { EtapaSincronizacaoBling } from '@plataforma/contratos';
import { z } from 'zod';

import { type AcessoBling, type ClienteBling, ErroBlingNaoEncontrado } from './cliente.js';

export type ProdutoSincronizado = {
  idBling: number;
  codigo: string | null;
  nome: string;
  formato: string;
  idProdutoPai: number | null;
};

export type ClienteSincronizado = {
  idBling: number;
  nome: string;
  fantasia: string | null;
  tipoPessoa: 'J' | 'F' | 'E' | null;
  // Só dígitos (CPF ou CNPJ).
  documento: string | null;
};

export type DadosSincronizacao = {
  produtos: ProdutoSincronizado[];
  clientes: ClienteSincronizado[];
  avisos: string[];
};

export type ProgressoSincronizacao = {
  etapa: EtapaSincronizacaoBling;
  lidos: number;
  total: number | null;
};

export type OpcoesSincronizacao = {
  acesso: AcessoBling;
  aoProgredir?: (progresso: ProgressoSincronizacao) => void;
  sinal?: AbortSignal;
};

// Só os campos usados; o zod descarta o resto (nenhum dado além destes sai do Bling).
const textoOuNulo = z
  .string()
  .nullish()
  .transform((valor) => (valor?.trim() ? valor.trim() : null));
const idOuNulo = z
  .number()
  .int()
  .nullish()
  .transform((valor) => (valor ? valor : null));

const EsquemaProduto = z.object({
  id: z.number().int(),
  idProdutoPai: idOuNulo,
  nome: z.string(),
  codigo: textoOuNulo,
  formato: z.string(),
});

const EsquemaTipoContato = z.object({ id: z.number().int(), descricao: z.string() });

const EsquemaContato = z.object({
  id: z.number().int(),
  nome: z.string(),
  situacao: z.string(),
  numeroDocumento: textoOuNulo,
});

const EsquemaDetalheContato = z.object({
  id: z.number().int(),
  nome: z.string(),
  fantasia: textoOuNulo,
  tipo: z.string().nullish(),
  numeroDocumento: textoOuNulo,
});

// `criterio=2`: produtos ativos. `criterio=1`: todos os contatos (o padrão do Bling é só os últimos incluídos).
const CRITERIO_PRODUTOS_ATIVOS = 2;
const CRITERIO_CONTATOS_TODOS = 1;
const SITUACAO_ATIVO = 'A';
const TIPOS_PESSOA = ['J', 'F', 'E'] as const;

export const AVISO_SEM_TIPO_CLIENTE =
  'Tipo de contato "Cliente" não encontrado no Bling; foram lidos todos os contatos ativos.';
export const avisoDetalheAusente = (idBling: number) =>
  `Contato ${idBling} não encontrado no detalhe; ficaram os dados da listagem.`;

const normalizar = (texto: string) =>
  texto
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .trim()
    .toLowerCase();

const soDigitos = (documento: string | null) => documento?.replace(/\D/g, '') || null;

const tipoPessoa = (tipo: string | null | undefined): ClienteSincronizado['tipoPessoa'] =>
  TIPOS_PESSOA.find((t) => t === tipo) ?? null;

// Lê produtos ativos, contatos ativos do tipo Cliente e o detalhe de cada um. Só GET no Bling.
export async function sincronizarBling(
  cliente: Pick<ClienteBling, 'listarTodas' | 'obter'>,
  { acesso, aoProgredir = () => {}, sinal }: OpcoesSincronizacao,
): Promise<DadosSincronizacao> {
  // Toda requisição passa por aqui: com o sinal abortado, para antes da próxima chamada.
  const acessoComSinal: AcessoBling = () => {
    sinal?.throwIfAborted();
    return acesso();
  };
  const avisos: string[] = [];

  aoProgredir({ etapa: 'produtos', lidos: 0, total: null });
  const produtos = (
    await cliente.listarTodas(
      '/produtos',
      { criterio: CRITERIO_PRODUTOS_ATIVOS },
      EsquemaProduto,
      acessoComSinal,
      (lidos) => aoProgredir({ etapa: 'produtos', lidos, total: null }),
    )
  ).map((p): ProdutoSincronizado => ({
    idBling: p.id,
    codigo: p.codigo,
    nome: p.nome,
    formato: p.formato,
    idProdutoPai: p.idProdutoPai,
  }));

  aoProgredir({ etapa: 'clientes', lidos: 0, total: null });
  const tipos = await cliente.obter('/contatos/tipos', z.array(EsquemaTipoContato), acessoComSinal);
  const tipoCliente = tipos.find((t) => normalizar(t.descricao) === 'cliente');
  if (!tipoCliente) avisos.push(AVISO_SEM_TIPO_CLIENTE);
  const contatos = await cliente.listarTodas(
    '/contatos',
    {
      criterio: CRITERIO_CONTATOS_TODOS,
      ...(tipoCliente && { idTipoContato: tipoCliente.id }),
    },
    EsquemaContato,
    acessoComSinal,
    (lidos) => aoProgredir({ etapa: 'clientes', lidos, total: null }),
  );
  const ativos = contatos.filter((c) => c.situacao === SITUACAO_ATIVO);

  const clientes: ClienteSincronizado[] = [];
  aoProgredir({ etapa: 'detalhes', lidos: 0, total: ativos.length });
  for (const contato of ativos) {
    try {
      const detalhe = await cliente.obter(
        `/contatos/${contato.id}`,
        EsquemaDetalheContato,
        acessoComSinal,
      );
      clientes.push({
        idBling: contato.id,
        nome: detalhe.nome,
        fantasia: detalhe.fantasia,
        tipoPessoa: tipoPessoa(detalhe.tipo),
        documento: soDigitos(detalhe.numeroDocumento),
      });
    } catch (erro) {
      if (!(erro instanceof ErroBlingNaoEncontrado)) throw erro;
      avisos.push(avisoDetalheAusente(contato.id));
      clientes.push({
        idBling: contato.id,
        nome: contato.nome,
        fantasia: null,
        tipoPessoa: null,
        documento: soDigitos(contato.numeroDocumento),
      });
    }
    aoProgredir({ etapa: 'detalhes', lidos: clientes.length, total: ativos.length });
  }

  return { produtos, clientes, avisos };
}
