import { z } from 'zod';

import { EsquemaPerfil } from './auth.ts';

// Senha mínima de qualquer cadastro ou troca (a API confere de novo).
export const SENHA_MINIMA = 10;
// Teto só para não passar textos enormes pelo scrypt.
export const SENHA_MAXIMA = 1024;

const EsquemaSenhaNova = z
  .string()
  .min(SENHA_MINIMA, `A senha precisa de ao menos ${SENHA_MINIMA} caracteres.`)
  .max(SENHA_MAXIMA);

// Criação de usuário pelo admin (tela). As empresas precisam estar todas entre as do admin
// (`podeAtribuirEmpresas`); o usuário troca a senha inicial no primeiro login.
export const EsquemaNovoUsuario = z.object({
  nome: z.string().trim().min(1, 'Nome obrigatório.').max(200),
  email: z.string().trim().toLowerCase().pipe(z.email('E-mail inválido.')),
  perfil: EsquemaPerfil,
  empresas: z.array(z.string().trim().toLowerCase().min(1)).min(1, 'Escolha ao menos uma empresa.'),
  senha: EsquemaSenhaNova,
});

// Usuário como a tela de usuários o mostra; nunca traz o hash da senha.
export const EsquemaUsuarioResumo = z.object({
  id: z.uuid(),
  nome: z.string(),
  email: z.email(),
  perfil: EsquemaPerfil,
  ativo: z.boolean(),
  // Slugs, em ordem alfabética.
  empresas: z.array(z.string()),
  criadoEm: z.iso.datetime(),
});

export type NovoUsuario = z.infer<typeof EsquemaNovoUsuario>;
export type UsuarioResumo = z.infer<typeof EsquemaUsuarioResumo>;

// O admin só atribui empresas que são dele: todas as pedidas dentro das do admin, sem repetir.
export function podeAtribuirEmpresas(
  empresasAdmin: readonly string[],
  empresasPedidas: readonly string[],
): boolean {
  if (empresasPedidas.length === 0) return false;
  if (new Set(empresasPedidas).size !== empresasPedidas.length) return false;
  return empresasPedidas.every((slug) => empresasAdmin.includes(slug));
}
