import { and, eq, ne } from 'drizzle-orm';

import type { Banco } from '../db/cliente.js';
import { blingConexoes } from '../db/esquema.js';
import type { Cifra } from './cifra.js';

// Conta do Bling autorizada pela empresa. `cnpj` só com dígitos.
export type ContaBling = { cnpj: string; nome: string };

export type ConexaoBling = {
  accessToken: string;
  accessExpiraEm: Date;
  refreshToken: string;
  autorizadoPor: string | null;
  autorizadoEm: Date;
  atualizadoEm: Date;
  // `null` nas conexões gravadas antes da verificação da conta.
  conta: ContaBling | null;
};

export type NovaConexaoBling = {
  accessToken: string;
  accessExpiraEm: Date;
  refreshToken: string;
  // Presente na autorização (quem clicou); ausente no refresh, que mantém o autor anterior.
  usuarioId?: string;
  // Presente na autorização; o refresh não muda a conta.
  conta?: ContaBling;
};

export type ConexoesBling = {
  obter(empresaId: string): Promise<ConexaoBling | null>;
  salvar(empresaId: string, conexao: NovaConexaoBling): Promise<void>;
  apagar(empresaId: string): Promise<void>;
  // Só a conta, sem decifrar os tokens (status para o app).
  conta(empresaId: string): Promise<ContaBling | null>;
  // Outra empresa (não `empresaId`) que já tem conexão com a conta deste CNPJ, se houver.
  outraEmpresaComConta(cnpj: string, empresaId: string): Promise<string | null>;
};

const contaDe = (linha: { contaCnpj: string | null; contaNome: string | null }) =>
  linha.contaCnpj === null ? null : { cnpj: linha.contaCnpj, nome: linha.contaNome ?? '' };

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
        conta: contaDe(linha),
      };
    },

    async salvar(empresaId, { accessToken, accessExpiraEm, refreshToken, usuarioId, conta }) {
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
      const daConta = conta === undefined ? {} : { contaCnpj: conta.cnpj, contaNome: conta.nome };
      await db
        .insert(blingConexoes)
        .values({
          empresaId,
          ...tokens,
          autorizadoPor: usuarioId ?? null,
          autorizadoEm: agora,
          ...daConta,
        })
        .onConflictDoUpdate({
          target: blingConexoes.empresaId,
          set: { ...tokens, ...autorizacao, ...daConta },
        });
    },

    async apagar(empresaId) {
      await db.delete(blingConexoes).where(eq(blingConexoes.empresaId, empresaId));
    },

    async conta(empresaId) {
      const [linha] = await db
        .select({ contaCnpj: blingConexoes.contaCnpj, contaNome: blingConexoes.contaNome })
        .from(blingConexoes)
        .where(eq(blingConexoes.empresaId, empresaId));
      return linha ? contaDe(linha) : null;
    },

    async outraEmpresaComConta(cnpj, empresaId) {
      const [linha] = await db
        .select({ empresaId: blingConexoes.empresaId })
        .from(blingConexoes)
        .where(and(eq(blingConexoes.contaCnpj, cnpj), ne(blingConexoes.empresaId, empresaId)))
        .limit(1);
      return linha?.empresaId ?? null;
    },
  };
}
