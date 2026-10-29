import { z } from 'zod';

export const LIMITE_PADRAO_CLIENTES = 20;
export const LIMITE_MAXIMO_CLIENTES = 50;

export const EsquemaCliente = z.object({
  id: z.uuid(),
  nomeExibicao: z.string(),
  razaoSocial: z.string(),
  nomeFantasia: z.string().nullable(),
  // 14 dígitos, sem pontuação.
  cnpj: z.string().regex(/^\d{14}$/),
});

// `proximoCursor` é opaco para o cliente; `null` na última página.
export const EsquemaPaginaClientes = z.object({
  itens: z.array(EsquemaCliente),
  proximoCursor: z.string().nullable(),
});

export const EsquemaConsultaClientes = z.object({
  busca: z.string().max(100).optional(),
  cursor: z.string().max(512).optional(),
  limite: z.coerce
    .number()
    .int()
    .min(1)
    .max(LIMITE_MAXIMO_CLIENTES)
    .default(LIMITE_PADRAO_CLIENTES),
});

export const EsquemaOpcao = z.object({ id: z.uuid(), nome: z.string() });

export const EsquemaProdutoDoCliente = EsquemaOpcao.extend({
  quantidadeArtes: z.number().int().min(1),
});

export type Cliente = z.infer<typeof EsquemaCliente>;
export type PaginaClientes = z.infer<typeof EsquemaPaginaClientes>;
export type ConsultaClientes = z.infer<typeof EsquemaConsultaClientes>;
export type Opcao = z.infer<typeof EsquemaOpcao>;
export type ProdutoDoCliente = z.infer<typeof EsquemaProdutoDoCliente>;

export const NOME_PADRAO_ARTE = 'Padrão';
export const NOME_ARTE_MAX = 100;

export const LIMITES = {
  pdfBytes: 25 * 1024 * 1024,
  imagemBytes: 10 * 1024 * 1024,
} as const;

export type TipoArquivo = 'pdf' | 'imagem';

export type TipoDetectado = {
  tipo: TipoArquivo;
  mime: 'application/pdf' | 'image/png' | 'image/jpeg' | 'image/webp';
};

const comecaCom = (bytes: Uint8Array, assinatura: number[], deslocamento = 0) =>
  assinatura.every((byte, i) => bytes[deslocamento + i] === byte);

// Tipo pelo conteúdo (assinatura nos primeiros bytes), nunca pela extensão. `null` se não for PDF, PNG, JPEG ou WebP.
export function detectarTipo(bytes: Uint8Array): TipoDetectado | null {
  if (comecaCom(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) {
    return { tipo: 'pdf', mime: 'application/pdf' };
  }
  if (comecaCom(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return { tipo: 'imagem', mime: 'image/png' };
  }
  if (comecaCom(bytes, [0xff, 0xd8, 0xff])) return { tipo: 'imagem', mime: 'image/jpeg' };
  // RIFF....WEBP
  if (comecaCom(bytes, [0x52, 0x49, 0x46, 0x46]) && comecaCom(bytes, [0x57, 0x45, 0x42, 0x50], 8)) {
    return { tipo: 'imagem', mime: 'image/webp' };
  }
  return null;
}

// Nome vazio (ou só espaços) vira "Padrão".
export const nomeOuPadrao = (nome: string | null | undefined): string =>
  nome?.trim() || NOME_PADRAO_ARTE;

export const rotuloArtes = (quantidade: number): string =>
  quantidade === 1 ? '1 arte' : `${quantidade} artes`;

export type EntradaArquivo = { tamanho: number; tipo: TipoArquivo | null } | null | undefined;

export type EntradaNovaArte = {
  produtoId: string;
  nome?: string | null;
  corId: string;
  maquinaIds: readonly string[];
  pdf?: EntradaArquivo;
  imagem?: EntradaArquivo;
};

export type CampoNovaArte = 'produtoId' | 'nome' | 'corId' | 'maquinaIds' | 'arquivos';

export type ErrosNovaArte = Partial<Record<CampoNovaArte, string>>;

function erroDoArquivo(arquivo: EntradaArquivo, esperado: TipoArquivo): string | null {
  if (!arquivo) return null;
  if (arquivo.tipo !== esperado) {
    return esperado === 'pdf'
      ? 'O arquivo precisa ser um PDF.'
      : 'A imagem precisa ser PNG, JPEG ou WebP.';
  }
  const limite = esperado === 'pdf' ? LIMITES.pdfBytes : LIMITES.imagemBytes;
  if (arquivo.tamanho <= 0) return 'O arquivo está vazio.';
  if (arquivo.tamanho > limite) return `O arquivo passa de ${limite / (1024 * 1024)} MB.`;
  return null;
}

// Regras de formato do cadastro, iguais no site, no app e na API. A existência de produto, cor e máquinas
// no banco é conferida só pela API.
export function validarNovaArte(entrada: EntradaNovaArte): ErrosNovaArte {
  const erros: ErrosNovaArte = {};
  if (!entrada.produtoId) erros.produtoId = 'Selecione um produto.';
  if (nomeOuPadrao(entrada.nome).length > NOME_ARTE_MAX) {
    erros.nome = `O nome pode ter no máximo ${NOME_ARTE_MAX} caracteres.`;
  }
  if (!entrada.corId) erros.corId = 'Selecione uma cor.';
  if (entrada.maquinaIds.length === 0) erros.maquinaIds = 'Selecione ao menos uma máquina.';
  const erroArquivo = erroDoArquivo(entrada.pdf, 'pdf') ?? erroDoArquivo(entrada.imagem, 'imagem');
  if (erroArquivo) erros.arquivos = erroArquivo;
  else if (!entrada.pdf && !entrada.imagem) erros.arquivos = 'Envie ao menos um arquivo.';
  return erros;
}

export const EsquemaArquivoArte = z.object({
  nomeOriginal: z.string(),
  tipoMime: z.string(),
  tamanho: z.number().int().positive(),
});

export const EsquemaArte = z.object({
  id: z.uuid(),
  clienteId: z.uuid(),
  produtoId: z.uuid(),
  nome: z.string(),
  corId: z.uuid(),
  maquinaIds: z.array(z.uuid()),
  pdf: EsquemaArquivoArte.nullable(),
  imagem: EsquemaArquivoArte.nullable(),
});

export type ArquivoArte = z.infer<typeof EsquemaArquivoArte>;
export type Arte = z.infer<typeof EsquemaArte>;
