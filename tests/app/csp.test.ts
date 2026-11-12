import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

// A janela do app só carrega o que é dela; a imagem da arte entra como `blob:` montado pelo próprio renderer
// a partir de bytes conferidos no main. Nada de `data:` nem domínio externo.
describe('CSP da janela', () => {
  const html = readFileSync(new URL('../../src/app/index.html', import.meta.url), 'utf8');
  const politica = /http-equiv="Content-Security-Policy"\s+content="([^"]+)"/.exec(html)?.[1] ?? '';
  const diretivas = new Map(
    politica
      .split(';')
      .map((diretiva) => diretiva.trim().split(/\s+/))
      .filter((partes) => partes[0])
      .map(([nome, ...valores]) => [nome, valores]),
  );

  it('libera só self e blob: nas imagens', () => {
    expect(diretivas.get('img-src')).toEqual(["'self'", 'blob:']);
  });

  it('mantém o resto fechado em self', () => {
    expect(diretivas.get('default-src')).toEqual(["'self'"]);
    expect(diretivas.get('script-src')).toEqual(["'self'"]);
  });
});
