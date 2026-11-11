import { describe, expect, it } from 'vitest';

import { empresasCom, mensagemTrocaSenha } from '../src/usuarios';

describe('mensagemTrocaSenha', () => {
  it('sem erro: nada; código conhecido: a mensagem dele', () => {
    expect(mensagemTrocaSenha(undefined)).toBeUndefined();
    expect(mensagemTrocaSenha('senha_atual_incorreta')).toBe('Senha atual incorreta.');
    expect(mensagemTrocaSenha('confirmacao')).toBe('A confirmação não confere com a nova senha.');
  });

  it('código desconhecido, repetido na URL ou herdado do Object: a genérica', () => {
    const generica = 'Não foi possível trocar a senha. Tente novamente.';
    expect(mensagemTrocaSenha('<script>')).toBe(generica);
    expect(mensagemTrocaSenha(['senha_repetida', 'x'])).toBe(generica);
    expect(mensagemTrocaSenha('toString')).toBe(generica);
  });
});

describe('empresasCom', () => {
  const eu = {
    empresas: [
      { slug: 'roma', nome: 'Roma Embalagens', permissoes: ['usuarios', 'usuarios.editar'] },
      {
        slug: 'aba',
        nome: 'ABA Embalagens',
        permissoes: ['usuarios', 'usuarios.editar', 'usuarios.permissoes'],
      },
      { slug: 'delta', nome: 'Delta', permissoes: ['usuarios.editar'] },
    ],
  };

  it('devolve, em ordem de nome, as empresas em que o usuário tem a permissão', () => {
    expect(empresasCom(eu, 'usuarios.editar').map((empresa) => empresa.slug)).toEqual([
      'aba',
      'roma',
    ]);
    expect(empresasCom(eu, 'usuarios.permissoes').map((empresa) => empresa.slug)).toEqual(['aba']);
  });

  it('subpermissão sem o módulo não conta; sem nenhuma, lista vazia', () => {
    expect(empresasCom(eu, 'artes')).toEqual([]);
  });
});
