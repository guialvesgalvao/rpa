import { describe, expect, it } from 'vitest';

import { localizarChrome } from '../../src/core/browser.js';

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
