import { describe, expect, it } from 'vitest';

import {
  EsquemaEu,
  EsquemaNovoUsuario,
  EsquemaTrocaSenha,
  podeAtribuirEmpresas,
  SENHA_MINIMA,
} from '../src/index.ts';

// Dados sintéticos.
const novo = {
  nome: ' Ana Ficticia ',
  email: ' Ana@Exemplo.com ',
  perfil: 'arte_finalista',
  empresas: ['ABA'],
  senha: 'x'.repeat(SENHA_MINIMA),
};

describe('usuários', () => {
  it('novo usuário: nome aparado, e-mail e empresas em minúsculas', () => {
    expect(EsquemaNovoUsuario.parse(novo)).toEqual({
      ...novo,
      nome: 'Ana Ficticia',
      email: 'ana@exemplo.com',
      empresas: ['aba'],
    });
  });

  it('novo usuário: recusa senha curta, sem empresa, perfil, e-mail e nome inválidos', () => {
    for (const invalido of [
      { ...novo, senha: 'x'.repeat(SENHA_MINIMA - 1) },
      { ...novo, empresas: [] },
      { ...novo, perfil: 'gerente' },
      { ...novo, email: 'ana' },
      { ...novo, nome: '  ' },
    ]) {
      expect(EsquemaNovoUsuario.safeParse(invalido).success).toBe(false);
    }
  });

  it('empresas: só as do admin, sem repetir e ao menos uma', () => {
    expect(podeAtribuirEmpresas(['aba'], ['aba'])).toBe(true);
    expect(podeAtribuirEmpresas(['aba'], ['roma'])).toBe(false);
    expect(podeAtribuirEmpresas(['aba'], ['aba', 'roma'])).toBe(false);
    expect(podeAtribuirEmpresas(['aba', 'roma'], ['roma'])).toBe(true);
    expect(podeAtribuirEmpresas(['aba', 'roma'], ['aba', 'roma'])).toBe(true);
    expect(podeAtribuirEmpresas(['aba', 'roma'], ['aba', 'aba'])).toBe(false);
    expect(podeAtribuirEmpresas(['aba'], [])).toBe(false);
  });

  it('troca de senha: nova com o mínimo; a sessão a manter é opcional', () => {
    const troca = { senhaAtual: 'atual', novaSenha: 'x'.repeat(SENHA_MINIMA) };
    expect(EsquemaTrocaSenha.parse(troca)).toEqual(troca);
    expect(EsquemaTrocaSenha.safeParse({ ...troca, novaSenha: 'curta' }).success).toBe(false);
    expect(EsquemaTrocaSenha.safeParse({ ...troca, senhaAtual: '' }).success).toBe(false);
    expect(EsquemaTrocaSenha.parse({ ...troca, renovacao: 'r' }).renovacao).toBe('r');
  });

  it('eu: sem deveTrocarSenha (API antiga ou sessão salva), vale false', () => {
    const eu = {
      id: '00000000-0000-4000-8000-000000000001',
      nome: 'Pessoa Ficticia',
      email: 'pessoa@exemplo.com',
      perfil: 'admin',
      empresas: [],
    };
    expect(EsquemaEu.parse(eu).deveTrocarSenha).toBe(false);
    expect(EsquemaEu.parse({ ...eu, deveTrocarSenha: true }).deveTrocarSenha).toBe(true);
  });
});
