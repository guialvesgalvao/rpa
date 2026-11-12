import {
  type Area,
  EsquemaArea,
  normalizarPermissoes,
  perfilLegado,
  type Permissao,
  PERMISSOES_DO_PERFIL,
  SENHA_MINIMA,
} from '@plataforma/contratos';
import { and, asc, eq, inArray, isNull, ne, or, sql } from 'drizzle-orm';
import { z } from 'zod';

import { conferirSenha, gerarHash } from '../auth/senha.js';
import { hashDoToken, type MotivoRevogacao } from '../auth/sessoes.js';
import type { Banco } from '../db/cliente.js';
import {
  empresas,
  type Perfil,
  PERFIS,
  sessoes,
  usuarioEmpresas,
  usuarios,
} from '../db/esquema.js';

export { SENHA_MINIMA };

// Erro de regra de negócio: a mensagem pode ser mostrada como está.
export class ErroUsuario extends Error {
  override name = 'ErroUsuario';

  constructor(
    mensagem: string,
    // Para a API escolher o status; os demais são dado inválido.
    readonly codigo?:
      | 'email_em_uso'
      | 'senha_atual_incorreta'
      | 'senha_repetida'
      | 'usuario_nao_encontrado'
      | 'ultimo_administrador',
  ) {
    super(mensagem);
  }
}

// Permissões por slug de empresa. Empresa sem entrada fica sem permissões.
export type PermissoesPorEmpresa = Record<string, readonly string[]>;

export type NovoUsuario = {
  email: string;
  nome: string;
  // Atalho da CLI e do app antigo: vira as permissões equivalentes em todas as empresas (`PERMISSOES_DO_PERFIL`).
  perfil?: Perfil;
  permissoes?: PermissoesPorEmpresa;
  area?: Area | null;
  senha: string;
  empresas: string[];
  // Senha inicial definida pelo admin na tela: a tela pede a troca no login. A CLI cria com `false`.
  deveTrocarSenha?: boolean;
};

export type UsuarioListado = {
  id: string;
  email: string;
  nome: string;
  // Derivado das permissões, só para o app antigo e a CLI (`perfilLegado`).
  perfil: Perfil;
  area: Area | null;
  ativo: boolean;
  empresas: string[];
  permissoes: Record<string, Permissao[]>;
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

async function idDoUsuario(tx: Transacao, email: string): Promise<string> {
  const [usuario] = await tx
    .select({ id: usuarios.id })
    .from(usuarios)
    .where(eq(usuarios.email, validar(EsquemaEmail, email)));
  if (!usuario) throw new ErroUsuario(`Usuário não encontrado: ${email.trim().toLowerCase()}.`);
  return usuario.id;
}

// Troca as empresas do usuário. A empresa que continua mantém as permissões que já tinha, a não ser que
// `permissoes` traga uma lista nova para ela; a empresa nova começa com a lista informada, ou sem nenhuma.
async function vincularEmpresas(
  tx: Transacao,
  usuarioId: string,
  slugs: string[],
  permissoes: PermissoesPorEmpresa = {},
) {
  const encontradas = await tx
    .select({ id: empresas.id, slug: empresas.slug })
    .from(empresas)
    .where(inArray(empresas.slug, slugs));
  const faltando = slugs.filter((slug) => !encontradas.some((e) => e.slug === slug));
  if (faltando.length > 0) throw new ErroUsuario(`Empresa inexistente: ${faltando.join(', ')}.`);

  const atuais = await tx
    .select({ empresaId: usuarioEmpresas.empresaId, permissoes: usuarioEmpresas.permissoes })
    .from(usuarioEmpresas)
    .where(eq(usuarioEmpresas.usuarioId, usuarioId));
  await tx.delete(usuarioEmpresas).where(eq(usuarioEmpresas.usuarioId, usuarioId));
  await tx.insert(usuarioEmpresas).values(
    encontradas.map(({ id: empresaId, slug }) => ({
      usuarioId,
      empresaId,
      permissoes: normalizarPermissoes(
        permissoes[slug] ?? atuais.find((atual) => atual.empresaId === empresaId)?.permissoes ?? [],
      ),
    })),
  );
}

export async function criarUsuario(db: Banco, dados: NovoUsuario): Promise<UsuarioListado> {
  const email = validar(EsquemaEmail, dados.email);
  const nome = validar(EsquemaNome, dados.nome);
  const perfil = dados.perfil === undefined ? undefined : validar(EsquemaPerfil, dados.perfil);
  const area = validar(EsquemaArea.nullable(), dados.area ?? null);
  const slugs = validar(EsquemaEmpresas, dados.empresas);
  const permissoes: PermissoesPorEmpresa =
    dados.permissoes ??
    (perfil ? Object.fromEntries(slugs.map((slug) => [slug, PERMISSOES_DO_PERFIL[perfil]])) : {});
  const senhaHash = await gerarHash(validar(EsquemaSenha, dados.senha));

  try {
    const id = await db.transaction(async (tx) => {
      const [usuario] = await tx
        .insert(usuarios)
        .values({ email, nome, area, senhaHash, deveTrocarSenha: dados.deveTrocarSenha ?? false })
        .returning({ id: usuarios.id });
      if (!usuario) throw new Error('Usuário não criado.');
      await vincularEmpresas(tx, usuario.id, slugs, permissoes);
      return usuario.id;
    });
    const [criado] = await listar(db, id);
    if (!criado) throw new Error('Usuário não criado.');
    return criado;
  } catch (erro) {
    if (violouUnico(erro))
      throw new ErroUsuario(`Já existe um usuário com o e-mail ${email}.`, 'email_em_uso');
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
      .set({
        revogadaEm: sql`now()`,
        motivoRevogacao: 'usuario_desativado' satisfies MotivoRevogacao,
      })
      .where(and(eq(sessoes.usuarioId, id), isNull(sessoes.revogadaEm)));
  });
}

// Troca da própria senha: confere a atual, grava a nova, desliga o pedido de troca e revoga as outras sessões
// (a de `manterRenovacao`, se informada, continua aberta).
export async function trocarSenha(
  db: Banco,
  dados: { usuarioId: string; senhaAtual: string; novaSenha: string; manterRenovacao?: string },
): Promise<void> {
  const [usuario] = await db
    .select({ senhaHash: usuarios.senhaHash })
    .from(usuarios)
    .where(eq(usuarios.id, dados.usuarioId));
  if (!usuario || !(await conferirSenha(dados.senhaAtual, usuario.senhaHash))) {
    throw new ErroUsuario('Senha atual incorreta.', 'senha_atual_incorreta');
  }
  if (dados.novaSenha === dados.senhaAtual) {
    throw new ErroUsuario('A nova senha precisa ser diferente da atual.', 'senha_repetida');
  }
  const senhaHash = await gerarHash(validar(EsquemaSenha, dados.novaSenha));
  const manter = dados.manterRenovacao ? hashDoToken(dados.manterRenovacao) : undefined;
  await db.transaction(async (tx) => {
    await tx
      .update(usuarios)
      .set({ senhaHash, deveTrocarSenha: false, atualizadoEm: sql`now()` })
      .where(eq(usuarios.id, dados.usuarioId));
    await tx
      .update(sessoes)
      .set({ revogadaEm: sql`now()`, motivoRevogacao: 'troca_senha' satisfies MotivoRevogacao })
      .where(
        and(
          eq(sessoes.usuarioId, dados.usuarioId),
          isNull(sessoes.revogadaEm),
          manter
            ? and(
                ne(sessoes.hashAtual, manter),
                or(isNull(sessoes.hashAnterior), ne(sessoes.hashAnterior, manter)),
              )
            : undefined,
        ),
      );
  });
}

export type Credenciais = { id: string; senhaHash: string; ativo: boolean };

export type PerfilUsuario = {
  id: string;
  nome: string;
  email: string;
  // Derivado das permissões, só para o app antigo (`perfilLegado`).
  perfil: Perfil;
  area: Area | null;
  // Falso para o desativado e para o excluído.
  ativo: boolean;
  deveTrocarSenha: boolean;
  empresas: { slug: string; nome: string; permissoes: Permissao[] }[];
};

// O que `exigirUsuario` lê a cada requisição: tirar uma permissão (ou excluir o usuário) vale na hora.
export type Acesso = { ativo: boolean; permissoes: Record<string, Permissao[]> };

const podeEntrar = sql<boolean>`${usuarios.ativo} and ${usuarios.excluidoEm} is null`;

// Para o login: o e-mail já chega normalizado pelo contrato.
export async function buscarCredenciais(
  db: Banco,
  email: string,
): Promise<Credenciais | undefined> {
  const [usuario] = await db
    .select({ id: usuarios.id, senhaHash: usuarios.senhaHash, ativo: podeEntrar })
    .from(usuarios)
    .where(eq(usuarios.email, email));
  return usuario;
}

export async function buscarAcesso(db: Banco, id: string): Promise<Acesso> {
  const linhas = await db
    .select({ ativo: podeEntrar, slug: empresas.slug, permissoes: usuarioEmpresas.permissoes })
    .from(usuarios)
    .leftJoin(usuarioEmpresas, eq(usuarioEmpresas.usuarioId, usuarios.id))
    .leftJoin(empresas, eq(empresas.id, usuarioEmpresas.empresaId))
    .where(eq(usuarios.id, id));
  const permissoes: Acesso['permissoes'] = {};
  for (const linha of linhas) {
    if (linha.slug) permissoes[linha.slug] = normalizarPermissoes(linha.permissoes ?? []);
  }
  return { ativo: linhas[0]?.ativo ?? false, permissoes };
}

// Dados e empresas atuais do usuário, lidos do banco (não do token).
export async function buscarPerfil(db: Banco, id: string): Promise<PerfilUsuario | undefined> {
  const linhas = await db
    .select({
      id: usuarios.id,
      nome: usuarios.nome,
      email: usuarios.email,
      area: usuarios.area,
      ativo: podeEntrar,
      deveTrocarSenha: usuarios.deveTrocarSenha,
      empresaSlug: empresas.slug,
      empresaNome: empresas.nome,
      permissoes: usuarioEmpresas.permissoes,
    })
    .from(usuarios)
    .leftJoin(usuarioEmpresas, eq(usuarioEmpresas.usuarioId, usuarios.id))
    .leftJoin(empresas, eq(empresas.id, usuarioEmpresas.empresaId))
    .where(eq(usuarios.id, id))
    .orderBy(asc(empresas.slug));

  const [primeira] = linhas;
  if (!primeira) return undefined;
  const { nome, email, area, ativo, deveTrocarSenha } = primeira;
  const vinculadas = linhas.flatMap(({ empresaSlug, empresaNome, permissoes }) =>
    empresaSlug && empresaNome
      ? [
          {
            slug: empresaSlug,
            nome: empresaNome,
            permissoes: normalizarPermissoes(permissoes ?? []),
          },
        ]
      : [],
  );
  const perfil = perfilLegado(vinculadas);
  return { id, nome, email, perfil, area, ativo, deveTrocarSenha, empresas: vinculadas };
}

// Usuários (com ao menos uma empresa) cujas empresas estão todas entre as informadas: o que o admin dessas
// empresas pode ver na tela. Nunca devolve o hash da senha.
export async function listarDoEscopo(
  db: Banco,
  slugs: readonly string[],
): Promise<UsuarioListado[]> {
  const todos = await listar(db);
  return todos.filter(
    (usuario) =>
      usuario.empresas.length > 0 && usuario.empresas.every((slug) => slugs.includes(slug)),
  );
}

// Nunca devolve o hash da senha nem os usuários excluídos.
export async function listar(db: Banco, id?: string): Promise<UsuarioListado[]> {
  const linhas = await db
    .select({
      id: usuarios.id,
      email: usuarios.email,
      nome: usuarios.nome,
      area: usuarios.area,
      ativo: usuarios.ativo,
      criadoEm: usuarios.criadoEm,
      empresa: empresas.slug,
      permissoes: usuarioEmpresas.permissoes,
    })
    .from(usuarios)
    .leftJoin(usuarioEmpresas, eq(usuarioEmpresas.usuarioId, usuarios.id))
    .leftJoin(empresas, eq(empresas.id, usuarioEmpresas.empresaId))
    .where(and(isNull(usuarios.excluidoEm), id ? eq(usuarios.id, id) : undefined))
    .orderBy(asc(usuarios.email), asc(empresas.slug));

  const porId = new Map<string, UsuarioListado>();
  for (const { empresa, permissoes, ...usuario } of linhas) {
    const listado = porId.get(usuario.id) ?? {
      ...usuario,
      perfil: 'arte_finalista' as Perfil,
      empresas: [],
      permissoes: {},
    };
    if (empresa) {
      listado.empresas.push(empresa);
      listado.permissoes[empresa] = normalizarPermissoes(permissoes ?? []);
    }
    porId.set(usuario.id, listado);
  }
  return [...porId.values()].map((usuario) => ({
    ...usuario,
    perfil: perfilLegado(Object.values(usuario.permissoes).map((lista) => ({ permissoes: lista }))),
  }));
}

// --- Painel de usuários (ADR 0011): editar, permissões por empresa e exclusão ---

const naoEncontrado = () => new ErroUsuario('Usuário não encontrado.', 'usuario_nao_encontrado');

// Empresas em que o usuário, se ativo, é quem edita permissões: as que não podem ficar sem ninguém assim.
async function empresasQueAdministra(tx: Transacao, usuarioId: string): Promise<string[]> {
  const linhas = await tx
    .select({ empresaId: usuarioEmpresas.empresaId })
    .from(usuarioEmpresas)
    .innerJoin(usuarios, eq(usuarios.id, usuarioEmpresas.usuarioId))
    .where(
      and(
        eq(usuarioEmpresas.usuarioId, usuarioId),
        eq(usuarios.ativo, true),
        isNull(usuarios.excluidoEm),
        sql`${usuarioEmpresas.permissoes} @> array['usuarios', 'usuarios.permissoes']::text[]`,
      ),
    );
  return linhas.map((linha) => linha.empresaId);
}

// Depois da mudança: cada empresa que o usuário administrava continua com alguém que edita permissões.
async function exigirAdministradores(tx: Transacao, empresaIds: string[]): Promise<void> {
  for (const empresaId of empresaIds) {
    const [resta] = await tx
      .select({ id: usuarios.id })
      .from(usuarioEmpresas)
      .innerJoin(usuarios, eq(usuarios.id, usuarioEmpresas.usuarioId))
      .where(
        and(
          eq(usuarioEmpresas.empresaId, empresaId),
          eq(usuarios.ativo, true),
          isNull(usuarios.excluidoEm),
          sql`${usuarioEmpresas.permissoes} @> array['usuarios', 'usuarios.permissoes']::text[]`,
        ),
      )
      .limit(1);
    if (!resta) {
      throw new ErroUsuario(
        'A empresa ficaria sem ninguém que possa editar permissões de usuários.',
        'ultimo_administrador',
      );
    }
  }
}

async function existente(tx: Transacao, usuarioId: string): Promise<void> {
  const [usuario] = await tx
    .select({ id: usuarios.id })
    .from(usuarios)
    .where(and(eq(usuarios.id, usuarioId), isNull(usuarios.excluidoEm)))
    .for('update');
  if (!usuario) throw naoEncontrado();
}

async function umListado(db: Banco, id: string): Promise<UsuarioListado> {
  const [usuario] = await listar(db, id);
  if (!usuario) throw naoEncontrado();
  return usuario;
}

export type EdicaoUsuario = {
  nome?: string;
  email?: string;
  area?: Area | null;
  empresas?: string[];
};

// Muda só o que vier. Trocar as empresas mantém as permissões das que continuam.
export async function editarUsuario(
  db: Banco,
  usuarioId: string,
  dados: EdicaoUsuario,
): Promise<UsuarioListado> {
  const nome = dados.nome === undefined ? undefined : validar(EsquemaNome, dados.nome);
  const email = dados.email === undefined ? undefined : validar(EsquemaEmail, dados.email);
  const area = dados.area === undefined ? undefined : validar(EsquemaArea.nullable(), dados.area);
  const slugs = dados.empresas === undefined ? undefined : validar(EsquemaEmpresas, dados.empresas);
  try {
    await db.transaction(async (tx) => {
      await existente(tx, usuarioId);
      const administrava = slugs ? await empresasQueAdministra(tx, usuarioId) : [];
      await tx
        .update(usuarios)
        .set({
          ...(nome === undefined ? {} : { nome }),
          ...(email === undefined ? {} : { email }),
          ...(area === undefined ? {} : { area }),
          atualizadoEm: sql`now()`,
        })
        .where(eq(usuarios.id, usuarioId));
      if (slugs) {
        await vincularEmpresas(tx, usuarioId, slugs);
        await exigirAdministradores(tx, administrava);
      }
    });
  } catch (erro) {
    if (violouUnico(erro))
      throw new ErroUsuario(`Já existe um usuário com o e-mail ${email}.`, 'email_em_uso');
    throw erro;
  }
  return umListado(db, usuarioId);
}

// Permissões do usuário numa empresa dele. Subpermissão sem o módulo é descartada.
export async function definirPermissoes(
  db: Banco,
  usuarioId: string,
  slug: string,
  permissoes: readonly string[],
): Promise<UsuarioListado> {
  await db.transaction(async (tx) => {
    await existente(tx, usuarioId);
    const [empresa] = await tx
      .select({ id: empresas.id })
      .from(empresas)
      .innerJoin(usuarioEmpresas, eq(usuarioEmpresas.empresaId, empresas.id))
      .where(and(eq(empresas.slug, slug), eq(usuarioEmpresas.usuarioId, usuarioId)));
    if (!empresa) throw naoEncontrado();
    const administrava = (await empresasQueAdministra(tx, usuarioId)).filter(
      (id) => id === empresa.id,
    );
    await tx
      .update(usuarioEmpresas)
      .set({ permissoes: normalizarPermissoes(permissoes) })
      .where(
        and(eq(usuarioEmpresas.usuarioId, usuarioId), eq(usuarioEmpresas.empresaId, empresa.id)),
      );
    await tx
      .update(usuarios)
      .set({ atualizadoEm: sql`now()` })
      .where(eq(usuarios.id, usuarioId));
    await exigirAdministradores(tx, administrava);
  });
  return umListado(db, usuarioId);
}

// Senha nova definida pelo painel: é temporária (o usuário troca no próximo login). Não revoga as sessões abertas.
export async function redefinirSenhaDoUsuario(
  db: Banco,
  usuarioId: string,
  senha: string,
): Promise<void> {
  const senhaHash = await gerarHash(validar(EsquemaSenha, senha));
  await db.transaction(async (tx) => {
    await existente(tx, usuarioId);
    await tx
      .update(usuarios)
      .set({ senhaHash, deveTrocarSenha: true, atualizadoEm: sql`now()` })
      .where(eq(usuarios.id, usuarioId));
  });
}

// Exclusão pela tela: a linha fica (o histórico continua mostrando o nome e o e-mail segue ocupado), o
// usuário some das listas e perde o acesso na hora.
export async function excluirUsuario(db: Banco, usuarioId: string): Promise<void> {
  await db.transaction(async (tx) => {
    await existente(tx, usuarioId);
    const administrava = await empresasQueAdministra(tx, usuarioId);
    await tx
      .update(usuarios)
      .set({ excluidoEm: sql`now()`, ativo: false, atualizadoEm: sql`now()` })
      .where(eq(usuarios.id, usuarioId));
    await tx
      .update(sessoes)
      .set({
        revogadaEm: sql`now()`,
        motivoRevogacao: 'usuario_excluido' satisfies MotivoRevogacao,
      })
      .where(and(eq(sessoes.usuarioId, usuarioId), isNull(sessoes.revogadaEm)));
    await exigirAdministradores(tx, administrava);
  });
}
