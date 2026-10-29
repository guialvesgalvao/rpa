import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';

import { gerarHash } from '../auth/senha.js';
import type { Banco } from '../db/cliente.js';
import {
  empresas,
  type Perfil,
  PERFIS,
  sessoes,
  usuarioEmpresas,
  usuarios,
} from '../db/esquema.js';

export const SENHA_MINIMA = 10;

// Erro de regra de negócio: a mensagem pode ser mostrada como está.
export class ErroUsuario extends Error {
  override name = 'ErroUsuario';
}

export type NovoUsuario = {
  email: string;
  nome: string;
  perfil: Perfil;
  senha: string;
  empresas: string[];
};

export type UsuarioListado = {
  id: string;
  email: string;
  nome: string;
  perfil: Perfil;
  ativo: boolean;
  empresas: string[];
  criadoEm: Date;
};

type Transacao = Parameters<Parameters<Banco['transaction']>[0]>[0];

const EsquemaEmail = z.string().trim().toLowerCase().pipe(z.email('E-mail inválido.'));
const EsquemaNome = z.string().trim().min(1, 'Nome obrigatório.');
const EsquemaPerfil = z.enum(PERFIS, `Perfil inválido (use ${PERFIS.join(' ou ')}).`);
const EsquemaSenha = z
  .string()
  .min(SENHA_MINIMA, `A senha precisa de ao menos ${SENHA_MINIMA} caracteres.`);
const EsquemaEmpresas = z
  .array(z.string().trim().toLowerCase())
  .transform((slugs) => [...new Set(slugs.filter(Boolean))])
  .refine((slugs) => slugs.length > 0, 'Informe ao menos uma empresa.');

function validar<T>(esquema: z.ZodType<T>, valor: unknown): T {
  const resultado = esquema.safeParse(valor);
  if (!resultado.success)
    throw new ErroUsuario(resultado.error.issues[0]?.message ?? 'Dado inválido.');
  return resultado.data;
}

// O Drizzle embrulha o erro do Postgres em `cause`.
function violouUnico(erro: unknown): boolean {
  const comCausa = erro as { code?: string; cause?: { code?: string } };
  return (comCausa.cause?.code ?? comCausa.code) === '23505';
}

async function idsDasEmpresas(tx: Transacao, slugs: string[]): Promise<string[]> {
  const encontradas = await tx
    .select({ id: empresas.id, slug: empresas.slug })
    .from(empresas)
    .where(inArray(empresas.slug, slugs));
  const faltando = slugs.filter((slug) => !encontradas.some((e) => e.slug === slug));
  if (faltando.length > 0) throw new ErroUsuario(`Empresa inexistente: ${faltando.join(', ')}.`);
  return encontradas.map((e) => e.id);
}

async function idDoUsuario(tx: Transacao, email: string): Promise<string> {
  const [usuario] = await tx
    .select({ id: usuarios.id })
    .from(usuarios)
    .where(eq(usuarios.email, validar(EsquemaEmail, email)));
  if (!usuario) throw new ErroUsuario(`Usuário não encontrado: ${email.trim().toLowerCase()}.`);
  return usuario.id;
}

async function vincularEmpresas(tx: Transacao, usuarioId: string, slugs: string[]) {
  const ids = await idsDasEmpresas(tx, slugs);
  await tx.delete(usuarioEmpresas).where(eq(usuarioEmpresas.usuarioId, usuarioId));
  await tx.insert(usuarioEmpresas).values(ids.map((empresaId) => ({ usuarioId, empresaId })));
}

export async function criarUsuario(db: Banco, dados: NovoUsuario): Promise<UsuarioListado> {
  const email = validar(EsquemaEmail, dados.email);
  const nome = validar(EsquemaNome, dados.nome);
  const perfil = validar(EsquemaPerfil, dados.perfil);
  const slugs = validar(EsquemaEmpresas, dados.empresas);
  const senhaHash = await gerarHash(validar(EsquemaSenha, dados.senha));

  try {
    const id = await db.transaction(async (tx) => {
      const [usuario] = await tx
        .insert(usuarios)
        .values({ email, nome, perfil, senhaHash })
        .returning({ id: usuarios.id });
      if (!usuario) throw new Error('Usuário não criado.');
      await vincularEmpresas(tx, usuario.id, slugs);
      return usuario.id;
    });
    const [criado] = await listar(db, id);
    if (!criado) throw new Error('Usuário não criado.');
    return criado;
  } catch (erro) {
    if (violouUnico(erro)) throw new ErroUsuario(`Já existe um usuário com o e-mail ${email}.`);
    throw erro;
  }
}

// Não revoga as sessões abertas; para isso, use `desativar`.
export async function redefinirSenha(db: Banco, email: string, senha: string): Promise<void> {
  const senhaHash = await gerarHash(validar(EsquemaSenha, senha));
  await db.transaction(async (tx) => {
    const id = await idDoUsuario(tx, email);
    await tx
      .update(usuarios)
      .set({ senhaHash, atualizadoEm: sql`now()` })
      .where(eq(usuarios.id, id));
  });
}

export async function definirEmpresas(db: Banco, email: string, slugs: string[]): Promise<void> {
  const validos = validar(EsquemaEmpresas, slugs);
  await db.transaction(async (tx) => {
    const id = await idDoUsuario(tx, email);
    await vincularEmpresas(tx, id, validos);
    await tx
      .update(usuarios)
      .set({ atualizadoEm: sql`now()` })
      .where(eq(usuarios.id, id));
  });
}

// Desativa e revoga as sessões ainda abertas. Repetir não muda nada.
export async function desativar(db: Banco, email: string): Promise<void> {
  await db.transaction(async (tx) => {
    const id = await idDoUsuario(tx, email);
    await tx
      .update(usuarios)
      .set({ ativo: false, atualizadoEm: sql`now()` })
      .where(eq(usuarios.id, id));
    await tx
      .update(sessoes)
      .set({ revogadaEm: sql`now()`, motivoRevogacao: 'usuario_desativado' })
      .where(and(eq(sessoes.usuarioId, id), isNull(sessoes.revogadaEm)));
  });
}

export type Credenciais = { id: string; senhaHash: string; ativo: boolean };

export type PerfilUsuario = {
  id: string;
  nome: string;
  email: string;
  perfil: Perfil;
  ativo: boolean;
  empresas: { slug: string; nome: string }[];
};

// Para o login: o e-mail já chega normalizado pelo contrato.
export async function buscarCredenciais(
  db: Banco,
  email: string,
): Promise<Credenciais | undefined> {
  const [usuario] = await db
    .select({ id: usuarios.id, senhaHash: usuarios.senhaHash, ativo: usuarios.ativo })
    .from(usuarios)
    .where(eq(usuarios.email, email));
  return usuario;
}

export async function usuarioAtivo(db: Banco, id: string): Promise<boolean> {
  const [usuario] = await db
    .select({ ativo: usuarios.ativo })
    .from(usuarios)
    .where(eq(usuarios.id, id));
  return usuario?.ativo ?? false;
}

// Dados e empresas atuais do usuário, lidos do banco (não do token).
export async function buscarPerfil(db: Banco, id: string): Promise<PerfilUsuario | undefined> {
  const linhas = await db
    .select({
      id: usuarios.id,
      nome: usuarios.nome,
      email: usuarios.email,
      perfil: usuarios.perfil,
      ativo: usuarios.ativo,
      empresaSlug: empresas.slug,
      empresaNome: empresas.nome,
    })
    .from(usuarios)
    .leftJoin(usuarioEmpresas, eq(usuarioEmpresas.usuarioId, usuarios.id))
    .leftJoin(empresas, eq(empresas.id, usuarioEmpresas.empresaId))
    .where(eq(usuarios.id, id))
    .orderBy(asc(empresas.slug));

  const [primeira] = linhas;
  if (!primeira) return undefined;
  const { nome, email, perfil, ativo } = primeira;
  const vinculadas = linhas.flatMap(({ empresaSlug, empresaNome }) =>
    empresaSlug && empresaNome ? [{ slug: empresaSlug, nome: empresaNome }] : [],
  );
  return { id, nome, email, perfil, ativo, empresas: vinculadas };
}

// Nunca devolve o hash da senha.
export async function listar(db: Banco, id?: string): Promise<UsuarioListado[]> {
  const linhas = await db
    .select({
      id: usuarios.id,
      email: usuarios.email,
      nome: usuarios.nome,
      perfil: usuarios.perfil,
      ativo: usuarios.ativo,
      criadoEm: usuarios.criadoEm,
      empresa: empresas.slug,
    })
    .from(usuarios)
    .leftJoin(usuarioEmpresas, eq(usuarioEmpresas.usuarioId, usuarios.id))
    .leftJoin(empresas, eq(empresas.id, usuarioEmpresas.empresaId))
    .where(id ? eq(usuarios.id, id) : undefined)
    .orderBy(asc(usuarios.email), asc(empresas.slug));

  const porId = new Map<string, UsuarioListado>();
  for (const { empresa, ...usuario } of linhas) {
    const listado = porId.get(usuario.id) ?? { ...usuario, empresas: [] };
    if (empresa) listado.empresas.push(empresa);
    porId.set(usuario.id, listado);
  }
  return [...porId.values()];
}
