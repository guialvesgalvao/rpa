import { z } from 'zod';

import { EsquemaPerfil, type Perfil } from './auth.ts';
import { EsquemaArea, EsquemaPermissao } from './permissoes.ts';

export const ROTULOS_PERFIL: Record<Perfil, string> = {
  admin: 'Administrador',
  arte_finalista: 'Arte finalista',
};

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

// Troca da própria senha. `renovacao`: a sessão de quem troca, que continua aberta; as outras são revogadas.
export const EsquemaTrocaSenha = z.object({
  senhaAtual: z.string().min(1).max(SENHA_MAXIMA),
  novaSenha: EsquemaSenhaNova,
  renovacao: z.string().min(1).max(256).optional(),
});

// Senha nova definida pelo painel para outro usuário (ADR 0013): é temporária, o usuário troca no próximo login.
export const EsquemaRedefinicaoSenha = z.object({ novaSenha: EsquemaSenhaNova });

const EsquemaNome = z.string().trim().min(1, 'Nome obrigatório.').max(200);
const EsquemaEmail = z.string().trim().toLowerCase().pipe(z.email('E-mail inválido.'));
const EsquemaSlugs = z
  .array(z.string().trim().toLowerCase().min(1))
  .min(1, 'Escolha ao menos uma empresa.');

// Criação pelo painel de usuários (ADR 0011). `permissoes`: por slug de empresa; só é aceito de quem tem
// "Editar permissão de usuários" naquela empresa. Sem ele, o usuário nasce sem permissões.
export const EsquemaCriacaoUsuario = z.object({
  nome: EsquemaNome,
  email: EsquemaEmail,
  area: EsquemaArea.nullable().default(null),
  empresas: EsquemaSlugs,
  senha: EsquemaSenhaNova,
  permissoes: z.record(z.string(), z.array(EsquemaPermissao)).default({}),
});

// Edição dos dados do usuário; só o que vier muda.
export const EsquemaEdicaoUsuario = z
  .object({
    nome: EsquemaNome,
    email: EsquemaEmail,
    area: EsquemaArea.nullable(),
    empresas: EsquemaSlugs,
  })
  .partial()
  .refine((dados) => Object.keys(dados).length > 0, 'Nada para alterar.');

// Permissões do usuário na empresa da rota.
export const EsquemaPermissoesUsuario = z.object({ permissoes: z.array(EsquemaPermissao) });

// Usuário como o painel o mostra, com as permissões em cada empresa dele.
export const EsquemaUsuarioDetalhe = z.object({
  id: z.uuid(),
  nome: z.string(),
  email: z.email(),
  area: EsquemaArea.nullable(),
  // Falso para quem foi desativado pela linha de comando; o excluído nem aparece.
  ativo: z.boolean(),
  empresas: z.array(z.object({ slug: z.string(), permissoes: z.array(z.string()) })),
  criadoEm: z.iso.datetime(),
});

export type CriacaoUsuario = z.infer<typeof EsquemaCriacaoUsuario>;
export type EdicaoUsuario = z.infer<typeof EsquemaEdicaoUsuario>;
export type RedefinicaoSenha = z.infer<typeof EsquemaRedefinicaoSenha>;
export type PermissoesUsuario = z.infer<typeof EsquemaPermissoesUsuario>;
export type UsuarioDetalhe = z.infer<typeof EsquemaUsuarioDetalhe>;
export type NovoUsuario = z.infer<typeof EsquemaNovoUsuario>;
export type TrocaSenha = z.infer<typeof EsquemaTrocaSenha>;
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
