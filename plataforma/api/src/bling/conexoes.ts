import { eq } from 'drizzle-orm';

import type { Banco } from '../db/cliente.js';
import { blingConexoes } from '../db/esquema.js';
import type { Cifra } from './cifra.js';

export type ConexaoBling = {
  accessToken: string;
  accessExpiraEm: Date;
  refreshToken: string;
  autorizadoPor: string | null;
  autorizadoEm: Date;
  atualizadoEm: Date;
};

export type NovaConexaoBling = {
  accessToken: string;
  accessExpiraEm: Date;
  refreshToken: string;
  // Presente na autorização (quem clicou); ausente no refresh, que mantém o autor anterior.
  usuarioId?: string;
};

export type ConexoesBling = {
  obter(empresaId: string): Promise<ConexaoBling | null>;
  salvar(empresaId: string, conexao: NovaConexaoBling): Promise<void>;
  apagar(empresaId: string): Promise<void>;
};

// Repositório de `bling_conexoes`: uma conexão por empresa, tokens sempre cifrados no banco.
export function criarConexoesBling({
  db,
  cifra,
  relogio = () => new Date(),
}: {
  db: Banco;
  cifra: Cifra;
  relogio?: () => Date;
}): ConexoesBling {
  return {
    async obter(empresaId) {
      const [linha] = await db
        .select()
        .from(blingConexoes)
        .where(eq(blingConexoes.empresaId, empresaId));
      if (!linha) return null;
      return {
        accessToken: cifra.decifrar(linha.accessTokenCifrado),
        accessExpiraEm: linha.accessExpiraEm,
        refreshToken: cifra.decifrar(linha.refreshTokenCifrado),
        autorizadoPor: linha.autorizadoPor,
        autorizadoEm: linha.autorizadoEm,
        atualizadoEm: linha.atualizadoEm,
      };
    },

    async salvar(empresaId, { accessToken, accessExpiraEm, refreshToken, usuarioId }) {
      const agora = relogio();
      const tokens = {
        accessTokenCifrado: cifra.cifrar(accessToken),
        accessExpiraEm,
        refreshTokenCifrado: cifra.cifrar(refreshToken),
        atualizadoEm: agora,
      };
      // Com usuário é uma nova autorização; sem ele (refresh), autor e data da autorização ficam.
      const autorizacao =
        usuarioId === undefined ? {} : { autorizadoPor: usuarioId, autorizadoEm: agora };
      await db
        .insert(blingConexoes)
        .values({ empresaId, ...tokens, autorizadoPor: usuarioId ?? null, autorizadoEm: agora })
        .onConflictDoUpdate({
          target: blingConexoes.empresaId,
          set: { ...tokens, ...autorizacao },
        });
    },

    async apagar(empresaId) {
      await db.delete(blingConexoes).where(eq(blingConexoes.empresaId, empresaId));
    },
  };
}
