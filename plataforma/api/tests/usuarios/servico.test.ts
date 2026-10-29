import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { conferirSenha } from '../../src/auth/senha.js';
import { sessoes, usuarios } from '../../src/db/esquema.js';
import {
  criarUsuario,
  definirEmpresas,
  desativar,
  ErroUsuario,
  listar,
  type NovoUsuario,
  redefinirSenha,
} from '../../src/usuarios/servico.js';
import { criarBancoTeste, limparTabelas } from '../helpers/banco.js';

const { db, fechar } = criarBancoTeste();
afterAll(() => fechar());
beforeEach(() => limparTabelas(db));

const SENHA = 'senha-ficticia-123';

const dados = (extra: Partial<NovoUsuario> = {}): NovoUsuario => ({
  email: 'ana@exemplo.com',
  nome: 'Ana Teste',
  perfil: 'arte_finalista',
  senha: SENHA,
  empresas: ['aba'],
  ...extra,
});

async function hashGravado(email: string): Promise<string> {
  const [linha] = await db
    .select({ senhaHash: usuarios.senhaHash })
    .from(usuarios)
    .where(eq(usuarios.email, email));
  if (!linha) throw new Error(`usuário ${email} não encontrado`);
  return linha.senhaHash;
}

describe('criarUsuario', () => {
  it('normaliza o e-mail, grava o hash e vincula as empresas', async () => {
    const criado = await criarUsuario(
      db,
      dados({ email: '  Ana@Exemplo.COM ', nome: ' Ana Teste ', empresas: ['roma', 'ABA', 'aba'] }),
    );

    expect(criado).toMatchObject({
      email: 'ana@exemplo.com',
      nome: 'Ana Teste',
      perfil: 'arte_finalista',
      ativo: true,
      empresas: ['aba', 'roma'],
    });
    expect(criado).not.toHaveProperty('senhaHash');
    const hash = await hashGravado('ana@exemplo.com');
    expect(hash).toMatch(/^scrypt\$/);
    expect(await conferirSenha(SENHA, hash)).toBe(true);
  });

  it('recusa e-mail duplicado, mesmo com outra caixa', async () => {
    await criarUsuario(db, dados());
    await expect(criarUsuario(db, dados({ email: 'ANA@exemplo.com' }))).rejects.toThrow(
      new ErroUsuario('Já existe um usuário com o e-mail ana@exemplo.com.'),
    );
  });

  it('recusa empresa inexistente sem gravar o usuário', async () => {
    await expect(criarUsuario(db, dados({ empresas: ['aba', 'xyz'] }))).rejects.toThrow(
      new ErroUsuario('Empresa inexistente: xyz.'),
    );
    expect(await db.$count(usuarios)).toBe(0);
  });

  it('recusa usuário sem empresa', async () => {
    await expect(criarUsuario(db, dados({ empresas: [' ', ''] }))).rejects.toThrow(
      new ErroUsuario('Informe ao menos uma empresa.'),
    );
  });

  it.each([
    ['senha curta', { senha: '123456789' }, 'A senha precisa de ao menos 10 caracteres.'],
    ['e-mail inválido', { email: 'ana' }, 'E-mail inválido.'],
    ['nome vazio', { nome: '  ' }, 'Nome obrigatório.'],
    [
      'perfil inválido',
      { perfil: 'gerente' as 'admin' },
      'Perfil inválido (use admin ou arte_finalista).',
    ],
  ])('recusa %s', async (_caso, extra, mensagem) => {
    await expect(criarUsuario(db, dados(extra))).rejects.toThrow(new ErroUsuario(mensagem));
  });
});

describe('redefinirSenha', () => {
  it('troca o hash pela nova senha', async () => {
    await criarUsuario(db, dados());
    await redefinirSenha(db, ' ANA@exemplo.com', 'outra-senha-ficticia');

    const hash = await hashGravado('ana@exemplo.com');
    expect(await conferirSenha('outra-senha-ficticia', hash)).toBe(true);
    expect(await conferirSenha(SENHA, hash)).toBe(false);
  });

  it('recusa usuário inexistente e senha curta', async () => {
    await expect(redefinirSenha(db, 'nao@exemplo.com', SENHA)).rejects.toThrow(
      new ErroUsuario('Usuário não encontrado: nao@exemplo.com.'),
    );
    await criarUsuario(db, dados());
    await expect(redefinirSenha(db, 'ana@exemplo.com', 'curta')).rejects.toThrow(ErroUsuario);
  });
});

describe('definirEmpresas', () => {
  it('substitui a lista de empresas', async () => {
    await criarUsuario(db, dados({ empresas: ['aba'] }));
    await definirEmpresas(db, 'ana@exemplo.com', ['roma']);
    expect((await listar(db))[0]?.empresas).toEqual(['roma']);
  });

  it('recusa lista vazia ou empresa inexistente sem mudar nada', async () => {
    await criarUsuario(db, dados({ empresas: ['aba'] }));
    await expect(definirEmpresas(db, 'ana@exemplo.com', [])).rejects.toThrow(ErroUsuario);
    await expect(definirEmpresas(db, 'ana@exemplo.com', ['roma', 'xyz'])).rejects.toThrow(
      new ErroUsuario('Empresa inexistente: xyz.'),
    );
    expect((await listar(db))[0]?.empresas).toEqual(['aba']);
  });
});

describe('desativar', () => {
  it('desativa o usuário e revoga só as sessões abertas', async () => {
    const ana = await criarUsuario(db, dados());
    const bia = await criarUsuario(db, dados({ email: 'bia@exemplo.com' }));
    const ontem = new Date(Date.now() - 24 * 60 * 60 * 1000);
    await db.insert(sessoes).values([
      { usuarioId: ana.id, origem: 'desktop', hashAtual: 'h-aberta' },
      {
        usuarioId: ana.id,
        origem: 'desktop',
        hashAtual: 'h-encerrada',
        revogadaEm: ontem,
        motivoRevogacao: 'logout',
      },
      { usuarioId: bia.id, origem: 'desktop', hashAtual: 'h-outra' },
    ]);

    await desativar(db, 'ana@exemplo.com');
    await desativar(db, 'ana@exemplo.com');

    const linhas = await db
      .select({
        hash: sessoes.hashAtual,
        revogadaEm: sessoes.revogadaEm,
        motivo: sessoes.motivoRevogacao,
      })
      .from(sessoes);
    const porHash = Object.fromEntries(linhas.map((s) => [s.hash, s]));
    expect(porHash['h-aberta']?.motivo).toBe('usuario_desativado');
    expect(porHash['h-aberta']?.revogadaEm).toBeInstanceOf(Date);
    expect(porHash['h-encerrada']).toMatchObject({ motivo: 'logout', revogadaEm: ontem });
    expect(porHash['h-outra']).toMatchObject({ motivo: null, revogadaEm: null });

    const lista = await listar(db);
    expect(lista.map((u) => [u.email, u.ativo])).toEqual([
      ['ana@exemplo.com', false],
      ['bia@exemplo.com', true],
    ]);
  });

  it('recusa usuário inexistente', async () => {
    await expect(desativar(db, 'nao@exemplo.com')).rejects.toThrow(ErroUsuario);
  });
});

describe('listar', () => {
  it('ordena por e-mail e nunca expõe o hash', async () => {
    await criarUsuario(
      db,
      dados({ email: 'bia@exemplo.com', perfil: 'admin', empresas: ['aba', 'roma'] }),
    );
    await criarUsuario(db, dados());

    const lista = await listar(db);
    expect(lista.map(({ email, perfil, empresas }) => ({ email, perfil, empresas }))).toEqual([
      { email: 'ana@exemplo.com', perfil: 'arte_finalista', empresas: ['aba'] },
      { email: 'bia@exemplo.com', perfil: 'admin', empresas: ['aba', 'roma'] },
    ]);
    expect(JSON.stringify(lista)).not.toContain('scrypt');
  });
});
