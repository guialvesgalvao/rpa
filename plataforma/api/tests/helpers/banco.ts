import { sql } from 'drizzle-orm';

import { type Banco, criarBanco } from '../../src/db/cliente.js';

const URL_PADRAO = 'postgres://rpa:rpa@localhost:5433/rpa_teste';

// Recusa qualquer banco que não seja de teste: os helpers apagam dados.
export function urlBancoTeste(): string {
  const url = process.env.DATABASE_URL_TESTE || URL_PADRAO;
  const nome = new URL(url).pathname.slice(1);
  if (!nome.endsWith('_teste')) {
    throw new Error(`DATABASE_URL_TESTE precisa apontar para um banco *_teste (recebido: ${nome})`);
  }
  return url;
}

export function criarBancoTeste() {
  return criarBanco(urlBancoTeste());
}

// Limpa os dados entre arquivos de teste. `empresas`, `cores` e `maquinas` ficam: vêm de migrações.
export async function limparTabelas(db: Banco): Promise<void> {
  await db.execute(
    sql`TRUNCATE arte_maquinas, artes, arquivos, clientes, produtos, usuarios, usuario_empresas, sessoes CASCADE`,
  );
}

// Código SQLSTATE do erro do Postgres (o Drizzle o embrulha em `cause`).
export async function codigoDoErro(promessa: PromiseLike<unknown>): Promise<string | undefined> {
  try {
    await promessa;
  } catch (erro) {
    const comCausa = erro as { code?: string; cause?: { code?: string } };
    return comCausa.cause?.code ?? comCausa.code;
  }
  return undefined;
}
