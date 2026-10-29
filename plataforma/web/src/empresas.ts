import type { Eu } from '@plataforma/contratos';

export type Empresa = Eu['empresas'][number];

// Logos em `public/empresas/`. Empresa sem logo aparece só pelo nome.
const LOGOS: Record<string, string> = {
  aba: '/empresas/aba.png',
};

// Slugs aceitos no cookie `rpa_empresa` e nas URLs geradas pelo site.
const FORMATO_SLUG = /^[a-z0-9-]{1,64}$/;

const ordemAlfabetica = new Intl.Collator('pt-BR', { sensitivity: 'base' });

export function logoDaEmpresa(slug: string): string | undefined {
  return Object.hasOwn(LOGOS, slug) ? LOGOS[slug] : undefined;
}

export function slugValido(slug: unknown): slug is string {
  return typeof slug === 'string' && FORMATO_SLUG.test(slug);
}

// Pelo nome, como o usuário lê (sem diferenciar acento nem caixa); o slug desempata.
export function ordenarEmpresas<T extends Empresa>(empresas: readonly T[]): T[] {
  return [...empresas].sort(
    (a, b) => ordemAlfabetica.compare(a.nome, b.nome) || ordemAlfabetica.compare(a.slug, b.slug),
  );
}
