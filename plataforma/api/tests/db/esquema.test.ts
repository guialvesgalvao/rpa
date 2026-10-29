import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { empresas, sessoes, usuarioEmpresas, usuarios } from '../../src/db/esquema.js';
import { migrar } from '../../src/db/migrar.js';
import { codigoDoErro, criarBancoTeste, limparTabelas, urlBancoTeste } from '../helpers/banco.js';

const VIOLA_CHECK = '23514';
const VIOLA_UNICO = '23505';

const { db, fechar } = criarBancoTeste();
afterAll(() => fechar());
beforeEach(() => limparTabelas(db));

const novoUsuario = (dados: Partial<typeof usuarios.$inferInsert> = {}) =>
  db
    .insert(usuarios)
    .values({
      email: 'ana@exemplo.com',
      nome: 'Ana Teste',
      senhaHash: 'hash-ficticio',
      perfil: 'admin',
      ...dados,
    })
    .returning();

async function criarUsuario() {
  const [usuario] = await novoUsuario();
  if (!usuario) throw new Error('usuário não criado');
  return usuario;
}

async function empresa(slug: string) {
  const [linha] = await db.select().from(empresas).where(eq(empresas.slug, slug));
  if (!linha) throw new Error(`empresa ${slug} não semeada`);
  return linha;
}

describe('migrações', () => {
  it('semeiam as empresas ABA e Roma', async () => {
    const linhas = await db.select({ slug: empresas.slug, nome: empresas.nome }).from(empresas);
    expect(linhas.sort((a, b) => a.slug.localeCompare(b.slug))).toEqual([
      { slug: 'aba', nome: 'ABA Embalagens' },
      { slug: 'roma', nome: 'Roma Embalagens' },
    ]);
  });

  it('podem ser aplicadas de novo sem erro nem duplicar empresas', async () => {
    await migrar(urlBancoTeste());
    expect(await db.$count(empresas)).toBe(2);
  });
});

describe('usuarios', () => {
  it('aceita um usuário válido com os padrões', async () => {
    const usuario = await criarUsuario();
    expect(usuario.ativo).toBe(true);
    expect(usuario.criadoEm).toBeInstanceOf(Date);
  });

  it('rejeita e-mail com maiúsculas', async () => {
    expect(await codigoDoErro(novoUsuario({ email: 'Ana@Exemplo.com' }))).toBe(VIOLA_CHECK);
  });

  it('rejeita e-mail duplicado', async () => {
    await criarUsuario();
    expect(await codigoDoErro(novoUsuario({ nome: 'Outra' }))).toBe(VIOLA_UNICO);
  });

  it('rejeita perfil inválido', async () => {
    const perfil = 'gerente' as 'admin';
    expect(await codigoDoErro(novoUsuario({ perfil }))).toBe(VIOLA_CHECK);
  });
});

describe('usuario_empresas', () => {
  it('rejeita vínculo duplicado', async () => {
    const usuario = await criarUsuario();
    const aba = await empresa('aba');
    await db.insert(usuarioEmpresas).values({ usuarioId: usuario.id, empresaId: aba.id });

    expect(
      await codigoDoErro(
        db.insert(usuarioEmpresas).values({ usuarioId: usuario.id, empresaId: aba.id }),
      ),
    ).toBe(VIOLA_UNICO);
  });

  it('some junto com o usuário', async () => {
    const usuario = await criarUsuario();
    const roma = await empresa('roma');
    await db.insert(usuarioEmpresas).values({ usuarioId: usuario.id, empresaId: roma.id });
    await db.insert(sessoes).values({ usuarioId: usuario.id, origem: 'desktop', hashAtual: 'h1' });

    await db.delete(usuarios).where(eq(usuarios.id, usuario.id));

    expect(await db.$count(usuarioEmpresas)).toBe(0);
    expect(await db.$count(sessoes)).toBe(0);
  });
});

describe('sessoes', () => {
  const amanha = new Date(Date.now() + 24 * 60 * 60 * 1000);

  it('aceita web com expiração e desktop sem expiração', async () => {
    const usuario = await criarUsuario();
    await db.insert(sessoes).values([
      { usuarioId: usuario.id, origem: 'web', hashAtual: 'h-web', expiraEm: amanha },
      { usuarioId: usuario.id, origem: 'desktop', hashAtual: 'h-desktop' },
    ]);
    expect(await db.$count(sessoes)).toBe(2);
  });

  it('rejeita web sem expiração e desktop com expiração', async () => {
    const usuario = await criarUsuario();
    expect(
      await codigoDoErro(
        db.insert(sessoes).values({ usuarioId: usuario.id, origem: 'web', hashAtual: 'h1' }),
      ),
    ).toBe(VIOLA_CHECK);
    expect(
      await codigoDoErro(
        db
          .insert(sessoes)
          .values({ usuarioId: usuario.id, origem: 'desktop', hashAtual: 'h2', expiraEm: amanha }),
      ),
    ).toBe(VIOLA_CHECK);
  });

  it('rejeita origem inválida e hash atual repetido', async () => {
    const usuario = await criarUsuario();
    const origem = 'mobile' as 'web';
    expect(
      await codigoDoErro(
        db
          .insert(sessoes)
          .values({ usuarioId: usuario.id, origem, hashAtual: 'h1', expiraEm: amanha }),
      ),
    ).toBe(VIOLA_CHECK);

    await db.insert(sessoes).values({ usuarioId: usuario.id, origem: 'desktop', hashAtual: 'h2' });
    expect(
      await codigoDoErro(
        db.insert(sessoes).values({ usuarioId: usuario.id, origem: 'desktop', hashAtual: 'h2' }),
      ),
    ).toBe(VIOLA_UNICO);
  });
});
