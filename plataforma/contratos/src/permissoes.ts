import { z } from 'zod';

// Catálogo de permissões (ADR 0011). Cada módulo da aba lateral tem uma permissão própria e, dentro dela, as
// subpermissões. A lista plana repete os valores do CHECK de `usuario_empresas.permissoes`: mudar junto.
export const PERMISSOES = [
  'artes',
  'artes.adicionar',
  'artes.editar',
  'artes.acompanhar',
  'faturas',
  'ops',
  'usuarios',
  'usuarios.permissoes',
  'usuarios.editar',
  'compras',
  'compras.pedir',
  'compras.acompanhar',
] as const;

export const EsquemaPermissao = z.enum(PERMISSOES);
export type Permissao = z.infer<typeof EsquemaPermissao>;

export interface ModuloPermissao {
  chave: Permissao;
  rotulo: string;
  subpermissoes: readonly { chave: Permissao; rotulo: string }[];
}

// A ordem é a do painel de usuários.
export const MODULOS: readonly ModuloPermissao[] = [
  {
    chave: 'artes',
    rotulo: 'Artes',
    subpermissoes: [
      { chave: 'artes.adicionar', rotulo: 'Pode adicionar novas' },
      { chave: 'artes.editar', rotulo: 'Pode editar e excluir' },
      { chave: 'artes.acompanhar', rotulo: 'Pode acompanhar todas as tarefas' },
    ],
  },
  { chave: 'faturas', rotulo: 'Faturas', subpermissoes: [] },
  { chave: 'ops', rotulo: 'OP’s', subpermissoes: [] },
  {
    chave: 'usuarios',
    rotulo: 'Usuários',
    subpermissoes: [
      { chave: 'usuarios.permissoes', rotulo: 'Editar permissão de usuários' },
      { chave: 'usuarios.editar', rotulo: 'Editar e excluir usuários' },
    ],
  },
  {
    chave: 'compras',
    rotulo: 'Compras',
    subpermissoes: [
      { chave: 'compras.pedir', rotulo: 'Pode fazer pedidos' },
      { chave: 'compras.acompanhar', rotulo: 'Pode acompanhar todos os pedidos' },
    ],
  },
];

// Os mesmos valores do CHECK de `usuarios.area`. Só informativa: não muda o que o usuário pode fazer.
export const AREAS = ['arte_finalista', 'producao', 'administracao', 'direcao'] as const;
export const EsquemaArea = z.enum(AREAS);
export type Area = z.infer<typeof EsquemaArea>;

export const ROTULOS_AREA: Record<Area, string> = {
  arte_finalista: 'Arte Finalista',
  producao: 'Produção',
  administracao: 'Administração',
  direcao: 'Direção',
};

export const SEM_AREA = 'Sem área';

export const rotuloArea = (area: Area | null | undefined): string =>
  area ? ROTULOS_AREA[area] : SEM_AREA;

const moduloDe = (chave: string): string => chave.split('.')[0] ?? chave;

/** A subpermissão só vale com o módulo dela marcado. */
export function temPermissao(permissoes: readonly string[] | undefined, chave: Permissao): boolean {
  if (!permissoes) return false;
  return permissoes.includes(chave) && permissoes.includes(moduloDe(chave));
}

/** Tira o que não é do catálogo, as repetidas e as subpermissões sem o módulo; devolve na ordem do catálogo. */
export function normalizarPermissoes(permissoes: readonly string[]): Permissao[] {
  return PERMISSOES.filter(
    (chave) => permissoes.includes(chave) && permissoes.includes(moduloDe(chave)),
  );
}

// O que os perfis antigos viraram na migração e o que a CLI e o app antigo ainda pedem.
export const PERMISSOES_DO_PERFIL: Record<'admin' | 'arte_finalista', readonly Permissao[]> = {
  admin: PERMISSOES,
  arte_finalista: ['artes', 'artes.adicionar'],
};

/**
 * Perfil devolvido só para o app antigo, que ainda exige o campo: `admin` para quem tem alguma permissão
 * fora do módulo Artes em alguma empresa. Não decide acesso: quem decide é a API, pelas permissões.
 */
export function perfilLegado(
  empresas: readonly { permissoes: readonly string[] }[],
): 'admin' | 'arte_finalista' {
  const foraDeArtes = empresas.some((empresa) =>
    normalizarPermissoes(empresa.permissoes).some((chave) => moduloDe(chave) !== 'artes'),
  );
  return foraDeArtes ? 'admin' : 'arte_finalista';
}

/** Módulos que o usuário pode abrir, na ordem do catálogo. */
export function modulosPermitidos(permissoes: readonly string[] | undefined): ModuloPermissao[] {
  return MODULOS.filter((modulo) => temPermissao(permissoes, modulo.chave));
}
