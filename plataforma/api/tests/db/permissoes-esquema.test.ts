import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { AREAS, PERMISSOES } from '@plataforma/contratos';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { AREAS_USUARIO, empresas, usuarioEmpresas, usuarios } from '../../src/db/esquema.js';
import { codigoDoErro, criarBancoTeste, limparTabelas } from '../helpers/banco.js';

const VIOLA_CHECK = '23514';
const MIGRACAO = fileURLToPath(
  new URL('../../drizzle/0017_permissoes_area_exclusao.sql', import.meta.url),
);

const { db, fechar } = criarBancoTeste();
afterAll(() => fechar());
beforeEach(() => limparTabelas(db));

async function empresa(slug: string) {
  const [linha] = await db.select().from(empresas).where(eq(empresas.slug, slug));
  if (!linha) throw new Error(`empresa ${slug} não semeada`);
  return linha;
}

async function usuarioCom(
  email: string,
  perfil: 'admin' | 'arte_finalista' | null,
  slugs: string[],
  permissoes: string[] = [],
) {
  const [usuario] = await db
    .insert(usuarios)
    .values({ email, nome: 'Pessoa Teste', senhaHash: 'hash-ficticio', perfil })
    .returning();
  if (!usuario) throw new Error('usuário não criado');
  for (const slug of slugs) {
    const { id: empresaId } = await empresa(slug);
    await db.insert(usuarioEmpresas).values({ usuarioId: usuario.id, empresaId, permissoes });
  }
  return usuario;
}

async function permissoesDe(usuarioId: string): Promise<Record<string, string[]>> {
  const linhas = await db
    .select({ slug: empresas.slug, permissoes: usuarioEmpresas.permissoes })
    .from(usuarioEmpresas)
    .innerJoin(empresas, eq(empresas.id, usuarioEmpresas.empresaId))
    .where(eq(usuarioEmpresas.usuarioId, usuarioId));
  return Object.fromEntries(linhas.map(({ slug, permissoes }) => [slug, permissoes]));
}

// Os `UPDATE` de conversão dos perfis, lidos do próprio arquivo da migração.
function conversoes(): string[] {
  return readFileSync(MIGRACAO, 'utf8')
    .split('--> statement-breakpoint')
    .map((comando) =>
      comando
        .split('\n')
        .filter((linha) => !linha.trimStart().startsWith('--'))
        .join('\n')
        .trim(),
    )
    .filter((comando) => comando.startsWith('UPDATE'));
}

async function converter() {
  for (const comando of conversoes()) await db.execute(sql.raw(comando));
}

describe('migração dos perfis para permissões', () => {
  it('tem uma conversão por perfil', () => {
    expect(conversoes()).toHaveLength(2);
  });

  it('administrador recebe todas as permissões em cada empresa dele', async () => {
    const admin = await usuarioCom('admin@exemplo.com', 'admin', ['aba', 'roma']);
    await converter();
    expect(await permissoesDe(admin.id)).toEqual({ aba: [...PERMISSOES], roma: [...PERMISSOES] });
  });

  it('arte-finalista recebe Artes com "adicionar"', async () => {
    const finalista = await usuarioCom('finalista@exemplo.com', 'arte_finalista', ['aba']);
    await converter();
    expect(await permissoesDe(finalista.id)).toEqual({ aba: ['artes', 'artes.adicionar'] });
  });

  it('repetir não muda nada e não mexe em quem já tem permissões ou não tem perfil', async () => {
    const admin = await usuarioCom('admin@exemplo.com', 'admin', ['aba'], ['compras']);
    const novo = await usuarioCom('novo@exemplo.com', null, ['aba']);
    const finalista = await usuarioCom('finalista@exemplo.com', 'arte_finalista', ['roma']);
    await converter();
    await converter();
    expect(await permissoesDe(admin.id)).toEqual({ aba: ['compras'] });
    expect(await permissoesDe(novo.id)).toEqual({ aba: [] });
    expect(await permissoesDe(finalista.id)).toEqual({ roma: ['artes', 'artes.adicionar'] });
  });
});

describe('colunas novas', () => {
  it('as áreas do banco são as do contrato', () => {
    expect([...AREAS_USUARIO]).toEqual([...AREAS]);
  });

  it('o CHECK aceita cada permissão do catálogo e recusa chave de fora', async () => {
    const usuario = await usuarioCom('pessoa@exemplo.com', null, []);
    const { id: empresaId } = await empresa('aba');
    await db
      .insert(usuarioEmpresas)
      .values({ usuarioId: usuario.id, empresaId, permissoes: [...PERMISSOES] });
    const { id: outra } = await empresa('roma');
    expect(
      await codigoDoErro(
        db
          .insert(usuarioEmpresas)
          .values({ usuarioId: usuario.id, empresaId: outra, permissoes: ['inventada'] }),
      ),
    ).toBe(VIOLA_CHECK);
  });

  it('usuário novo nasce sem perfil, sem área e não excluído; área inválida é recusada', async () => {
    const usuario = await usuarioCom('pessoa@exemplo.com', null, ['aba']);
    expect(usuario).toMatchObject({ perfil: null, area: null, excluidoEm: null });
    expect(await permissoesDe(usuario.id)).toEqual({ aba: [] });
    expect(
      await codigoDoErro(
        db
          .update(usuarios)
          .set({ area: 'financeiro' as 'producao' })
          .where(eq(usuarios.id, usuario.id)),
      ),
    ).toBe(VIOLA_CHECK);
    await db.update(usuarios).set({ area: 'producao' }).where(eq(usuarios.id, usuario.id));
  });
});
