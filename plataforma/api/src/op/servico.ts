import { sql } from 'drizzle-orm';

import type { Banco } from '../db/cliente.js';
import { opContadores } from '../db/esquema.js';

// Reserva `quantidade` números consecutivos para a empresa. O upsert trava a linha do contador, então
// reservas simultâneas nunca repetem número; um número reservado e não usado deixa buraco na sequência.
export async function reservarNumerosOp(
  db: Banco,
  empresaId: string,
  quantidade: number,
): Promise<number[]> {
  const [linha] = await db
    .insert(opContadores)
    .values({ empresaId, ultimo: quantidade })
    .onConflictDoUpdate({
      target: opContadores.empresaId,
      set: { ultimo: sql`${opContadores.ultimo} + ${quantidade}` },
    })
    .returning({ ultimo: opContadores.ultimo });
  if (!linha) throw new Error('Contador de OP não atualizado.');
  const primeiro = linha.ultimo - quantidade + 1;
  return Array.from({ length: quantidade }, (_, i) => primeiro + i);
}
