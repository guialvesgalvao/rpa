import { z } from 'zod';

export const LIMITE_RESERVA_OP = 100;

// Pedido de reserva de números de OP: um número por OP que o app vai gerar.
export const EsquemaReservaNumerosOp = z.object({
  quantidade: z.number().int().min(1).max(LIMITE_RESERVA_OP),
});

// Números consecutivos e crescentes, nunca repetidos para a empresa.
export const EsquemaNumerosOp = z.object({
  numeros: z.array(z.number().int().positive()).min(1),
});

export type ReservaNumerosOp = z.infer<typeof EsquemaReservaNumerosOp>;
export type NumerosOp = z.infer<typeof EsquemaNumerosOp>;
