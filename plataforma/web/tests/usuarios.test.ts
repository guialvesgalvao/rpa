import { describe, expect, it } from 'vitest';

import { mensagemTrocaSenha, opcoesDeEmpresa } from '../src/usuarios';

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

describe('opcoesDeEmpresa', () => {
  const aba = { slug: 'aba', nome: 'ABA Embalagens' };
  const roma = { slug: 'roma', nome: 'Roma Embalagens' };

  it('uma empresa: fixa', () => {
    expect(opcoesDeEmpresa([roma])).toEqual({ opcoes: [roma], fixa: true });
  });

  it('várias: em ordem de nome, livres', () => {
    expect(opcoesDeEmpresa([roma, aba])).toEqual({ opcoes: [aba, roma], fixa: false });
  });
});
