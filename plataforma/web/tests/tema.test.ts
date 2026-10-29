import { TEMA_NEUTRO, TEMAS } from '@plataforma/contratos';
import { describe, expect, it } from 'vitest';

import { cssDosTemas } from '../src/tema';

describe('cssDosTemas', () => {
  const css = cssDosTemas();

  it('aplica o tema neutro em :root', () => {
    expect(css).toContain(`:root { --cor-primaria: ${TEMA_NEUTRO.primaria};`);
  });

  it('gera um bloco [data-empresa] por empresa de TEMAS', () => {
    for (const slug of Object.keys(TEMAS)) {
      expect(css).toContain(`[data-empresa='${slug}'] {`);
    }
    expect(css).toContain(`--cor-destaque-escura: ${TEMAS.aba.destaqueEscura};`);
  });
});
