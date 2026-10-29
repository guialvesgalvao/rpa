import { z } from 'zod';

import { type PedidoSelecao, TODOS_DOCS } from '../processes/bling/selecao.js';

const schema = z.array(
  z.object({
    numero: z.string().regex(/^\d+$/, 'Número de pedido inválido'),
    docs: z.array(z.enum(TODOS_DOCS)),
  }),
);

/**
 * Valida a seleção que chega da janela pelo IPC. Pedido sem documento fica de fora; documento
 * repetido conta uma vez. Lança erro se o formato for inválido ou se não sobrar nenhum pedido.
 */
export function validarSelecao(input: unknown): PedidoSelecao[] {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    throw new Error(`Seleção inválida: ${parsed.error.issues[0]?.message ?? 'formato inesperado'}`);
  }
  const selecao = parsed.data
    .map(({ numero, docs }) => ({ numero, docs: [...new Set(docs)] }))
    .filter(({ docs }) => docs.length > 0);
  if (!selecao.length) throw new Error('Selecione ao menos um pedido com um documento.');
  return selecao;
}

const slugSchema = z.string().trim().min(1).max(100);

/** Valida o slug da empresa que chega da janela pelo IPC; a checagem contra o perfil é do main. */
export function validarSlug(input: unknown): string {
  const parsed = slugSchema.safeParse(input);
  if (!parsed.success) throw new Error('Empresa inválida.');
  return parsed.data;
}

const loginSchema = z.object({
  email: z.string().trim().min(1).max(200),
  senha: z.string().min(1).max(200),
});

/** Valida o login que chega da janela pelo IPC (e-mail e senha de até 200 caracteres). */
export function validarLogin(input: unknown): { email: string; senha: string } {
  const parsed = loginSchema.safeParse(input);
  if (!parsed.success) throw new Error('Informe o e-mail e a senha.');
  return parsed.data;
}

const idSchema = z.uuid();

/** Valida um id (cliente, arquivo escolhido) que chega da janela pelo IPC. */
export function validarId(input: unknown): string {
  const parsed = idSchema.safeParse(input);
  if (!parsed.success) throw new Error('Identificador inválido.');
  return parsed.data;
}

const consultaClientesSchema = z.object({
  busca: z.string().max(100).optional(),
  cursor: z.string().max(512).nullish(),
});

/** Valida a busca e o cursor (opaco) da lista de clientes; a API valida o cursor em si. */
export function validarConsultaClientes(input: unknown): { busca?: string; cursor?: string } {
  const parsed = consultaClientesSchema.safeParse(input);
  if (!parsed.success) throw new Error('Busca inválida.');
  const { busca, cursor } = parsed.data;
  return { busca: busca?.trim() || undefined, cursor: cursor || undefined };
}

/** Valida o tipo de arquivo que a janela pede para escolher. */
export function validarTipoArquivo(input: unknown): 'pdf' | 'imagem' {
  const parsed = z.enum(['pdf', 'imagem']).safeParse(input);
  if (!parsed.success) throw new Error('Tipo de arquivo inválido.');
  return parsed.data;
}

const cadastroSchema = z.object({
  clienteId: z.uuid(),
  // Ids vazios passam: `validarNovaArte` devolve "Selecione um produto/cor" ao lado do campo.
  produtoId: z.string().max(100),
  nome: z.string().max(500).optional(),
  corId: z.string().max(100),
  maquinaIds: z.array(z.string().max(100)).max(20),
  pdfId: z.uuid().optional(),
  imagemId: z.uuid().optional(),
});

export type CadastroEntrada = z.infer<typeof cadastroSchema>;

/** Valida o cadastro de arte que chega da janela pelo IPC; os arquivos vêm como ids de `escolherArquivo`. */
export function validarCadastro(input: unknown): CadastroEntrada {
  const parsed = cadastroSchema.safeParse(input);
  if (!parsed.success) throw new Error('Dados da arte inválidos.');
  return parsed.data;
}
