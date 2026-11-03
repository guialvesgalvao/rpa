import { describe, expect, it } from 'vitest';

import { localizarChrome, withPaginaOculta } from '../../src/core/browser.js';

const PADRAO = String.raw`C:\Program Files\Google\Chrome\Application\chrome.exe`;
const POR_USUARIO = String.raw`C:\Users\fulano\AppData\Local\Google\Chrome\Application\chrome.exe`;
const env = { LOCALAPPDATA: String.raw`C:\Users\fulano\AppData\Local` };

describe('localizarChrome', () => {
  it('usa o caminho configurado quando ele existe', () => {
    expect(localizarChrome(PADRAO, env, () => true)).toBe(PADRAO);
  });

  it('cai na instalação por usuário quando o configurado não existe', () => {
    expect(localizarChrome(PADRAO, env, (caminho) => caminho === POR_USUARIO)).toBe(POR_USUARIO);
  });

  it('falha com mensagem amigável quando não encontra o Chrome', () => {
    expect(() => localizarChrome(PADRAO, env, () => false)).toThrow(
      /Google Chrome não encontrado .*Configurações/,
    );
    expect(() => localizarChrome(PADRAO, {}, () => false)).toThrow(/não encontrado/);
  });
});

describe('withPaginaOculta', () => {
  // Precisa do Chromium do Playwright (`npm run browsers:install`).
  it('abre uma guia em branco, devolve o resultado e fecha o navegador', async () => {
    let aberta: import('playwright').Page | undefined;
    const pdf = await withPaginaOculta(
      { browserChannel: 'chromium', chromePath: '' },
      async (page) => {
        aberta = page;
        await page.setContent('<p>OP</p>');
        return page.pdf();
      },
    );
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(aberta?.isClosed()).toBe(true);
  }, 60_000);

  it('fecha o navegador mesmo quando a função falha', async () => {
    let aberta: import('playwright').Page | undefined;
    await expect(
      withPaginaOculta({ browserChannel: 'chromium', chromePath: '' }, async (page) => {
        aberta = page;
        throw new Error('falhou');
      }),
    ).rejects.toThrow('falhou');
    expect(aberta?.isClosed()).toBe(true);
  }, 60_000);
});
