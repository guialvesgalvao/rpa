import { createHash, randomBytes } from 'node:crypto';
import { and, eq, isNull, or } from 'drizzle-orm';

import type { Banco } from '../db/cliente.js';
import { type OrigemSessao, sessoes } from '../db/esquema.js';

// Sessão web: expira após 30 dias sem uso; cada renovação empurra o prazo.
export const DURACAO_WEB_MS = 30 * 24 * 60 * 60 * 1000;
// Reuso do token anterior até 60 s depois da rotação é corrida (ex.: duas abas); depois disso, roubo.
export const JANELA_CORRIDA_MS = 60 * 1000;

const BYTES_RENOVACAO = 32;

export type MotivoRevogacao = 'logout' | 'reuso_detectado';

export type ResultadoRenovacao =
  | { ok: true; usuarioId: string; renovacao: string }
  | { ok: false; motivo: 'desconhecida' | 'revogada' | 'expirada' | 'reuso' };

// Só o SHA-256 do token de renovação vai para o banco.
export function hashDoToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function novoToken() {
  const token = randomBytes(BYTES_RENOVACAO).toString('base64url');
  return { token, hash: hashDoToken(token) };
}

const expiracao = (origem: OrigemSessao, agora: Date) =>
  origem === 'web' ? new Date(agora.getTime() + DURACAO_WEB_MS) : null;

const peloToken = (hash: string) => or(eq(sessoes.hashAtual, hash), eq(sessoes.hashAnterior, hash));

// Devolve o token de renovação; ele não é gravado.
export async function criarSessao(
  db: Banco,
  usuarioId: string,
  origem: OrigemSessao,
  agora: Date,
): Promise<string> {
  const { token, hash } = novoToken();
  await db.insert(sessoes).values({
    usuarioId,
    origem,
    hashAtual: hash,
    expiraEm: expiracao(origem, agora),
    criadaEm: agora,
    ultimoUsoEm: agora,
  });
  return token;
}

// Rotaciona o token: o atual vira o anterior. O reuso do anterior fora da janela de corrida revoga a sessão.
export async function renovarSessao(
  db: Banco,
  token: string,
  agora: Date,
): Promise<ResultadoRenovacao> {
  const hash = hashDoToken(token);
  return db.transaction(async (tx) => {
    // A trava serializa renovações simultâneas da mesma sessão.
    const [sessao] = await tx.select().from(sessoes).where(peloToken(hash)).limit(1).for('update');
    if (!sessao) return { ok: false, motivo: 'desconhecida' };
    if (sessao.revogadaEm) return { ok: false, motivo: 'revogada' };
    if (sessao.expiraEm && sessao.expiraEm <= agora) return { ok: false, motivo: 'expirada' };

    if (sessao.hashAtual !== hash) {
      const desdeRotacao = sessao.rotacionadaEm
        ? agora.getTime() - sessao.rotacionadaEm.getTime()
        : Infinity;
      if (desdeRotacao > JANELA_CORRIDA_MS) {
        await tx
          .update(sessoes)
          .set({ revogadaEm: agora, motivoRevogacao: 'reuso_detectado' satisfies MotivoRevogacao })
          .where(eq(sessoes.id, sessao.id));
        return { ok: false, motivo: 'reuso' };
      }
    }

    const novo = novoToken();
    await tx
      .update(sessoes)
      .set({
        hashAtual: novo.hash,
        hashAnterior: sessao.hashAtual,
        rotacionadaEm: agora,
        ultimoUsoEm: agora,
        expiraEm: expiracao(sessao.origem, agora),
      })
      .where(eq(sessoes.id, sessao.id));
    return { ok: true, usuarioId: sessao.usuarioId, renovacao: novo.token };
  });
}

// Idempotente: token desconhecido ou sessão já revogada não muda nada.
export async function revogarSessao(
  db: Banco,
  token: string,
  agora: Date,
  motivo: MotivoRevogacao = 'logout',
): Promise<void> {
  await db
    .update(sessoes)
    .set({ revogadaEm: agora, motivoRevogacao: motivo })
    .where(and(peloToken(hashDoToken(token)), isNull(sessoes.revogadaEm)));
}
