import { TEMA_NEUTRO, TEMAS, type Tema } from '@plataforma/contratos';

function variaveis(tema: Tema): string {
  return [
    `--cor-primaria: ${tema.primaria};`,
    `--cor-primaria-escura: ${tema.primariaEscura};`,
    `--cor-destaque: ${tema.destaque};`,
    `--cor-destaque-escura: ${tema.destaqueEscura};`,
  ].join(' ');
}

// CSS das cores por empresa: o tema neutro em `:root` e um bloco `[data-empresa='slug']` por empresa de `TEMAS`.
export function cssDosTemas(): string {
  const blocos = [`:root { ${variaveis(TEMA_NEUTRO)} }`];
  for (const [slug, tema] of Object.entries(TEMAS)) {
    blocos.push(`[data-empresa='${slug}'] { ${variaveis(tema)} }`);
  }
  return blocos.join('\n');
}
