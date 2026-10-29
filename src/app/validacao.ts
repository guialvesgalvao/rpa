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
