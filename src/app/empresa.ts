/** Logo por slug de empresa; sem entrada, o topo mostra só o nome (a Roma ainda não enviou a logo). */
const LOGOS: Record<string, string> = { aba: 'assets/logo-aba.png' };

export function logoDaEmpresa(slug: string): string | undefined {
  return Object.hasOwn(LOGOS, slug) ? LOGOS[slug] : undefined;
}

/** Nome para mostrar; sem nome cadastrado, o slug. */
export function rotuloEmpresa(nome: string, slug: string): string {
  return nome.trim() || slug;
}

export function tituloJanela(rotulo: string | undefined): string {
  return rotulo ? `${rotulo} — Automações` : 'Automações';
}

/** Só troca com mais de uma empresa e fora de uma execução (o perfil do Chrome é por empresa). */
export function podeTrocarEmpresa(running: boolean, totalEmpresas: number): boolean {
  return !running && totalEmpresas > 1;
}
