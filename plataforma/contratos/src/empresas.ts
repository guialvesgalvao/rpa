// Identidade visual por empresa, usada pelo site e pelo app desktop. As chaves são os slugs da tabela `empresas`.
export interface Tema {
  primaria: string;
  primariaEscura: string;
  destaque: string;
  destaqueEscura: string;
}

// Paleta cinza para slugs sem identidade cadastrada.
export const TEMA_NEUTRO: Tema = {
  primaria: '#495057',
  primariaEscura: '#343a40',
  destaque: '#5c6670',
  destaqueEscura: '#474f57',
};

export const TEMAS = {
  // Os valores de `--aba-*` do app (`src/app/index.html`).
  aba: {
    primaria: '#b62b38',
    primariaEscura: '#962330',
    destaque: '#4d9801',
    destaqueEscura: '#3e7a01',
  },
  // Provisório: as cores da Roma ainda não foram enviadas.
  roma: TEMA_NEUTRO,
} as const satisfies Record<string, Tema>;

export function temaDaEmpresa(slug: string): Tema {
  return Object.hasOwn(TEMAS, slug) ? TEMAS[slug as keyof typeof TEMAS] : TEMA_NEUTRO;
}
