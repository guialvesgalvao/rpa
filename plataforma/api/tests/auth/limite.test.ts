import { describe, expect, it } from 'vitest';

import { criarLimite, JANELA_TENTATIVAS_MS } from '../../src/auth/limite.js';
import { criarRelogioFalso } from '../helpers/app.js';

const EMAIL = 'ana@exemplo.com';

describe('criarLimite', () => {
  it('bloqueia na 5ª tentativa dentro de 15 min, por e-mail', () => {
    const limite = criarLimite(criarRelogioFalso().agora);
    for (let i = 0; i < 4; i++) limite.registrarTentativa(EMAIL);
    expect(limite.bloqueado(EMAIL)).toBe(false);

    limite.registrarTentativa(EMAIL);
    expect(limite.bloqueado(EMAIL)).toBe(true);
    expect(limite.bloqueado('bia@exemplo.com')).toBe(false);
  });

  it('libera conforme as tentativas saem da janela', () => {
    const relogio = criarRelogioFalso();
    const limite = criarLimite(relogio.agora);
    limite.registrarTentativa(EMAIL);
    relogio.avancar(60_000);
    for (let i = 0; i < 4; i++) limite.registrarTentativa(EMAIL);
    expect(limite.bloqueado(EMAIL)).toBe(true);

    relogio.avancar(JANELA_TENTATIVAS_MS - 60_000);
    expect(limite.bloqueado(EMAIL)).toBe(false);
    limite.registrarTentativa(EMAIL);
    expect(limite.bloqueado(EMAIL)).toBe(true);
  });

  it('limpar zera a conta do e-mail', () => {
    const limite = criarLimite(criarRelogioFalso().agora);
    for (let i = 0; i < 5; i++) limite.registrarTentativa(EMAIL);
    limite.limpar(EMAIL);
    expect(limite.bloqueado(EMAIL)).toBe(false);
  });
});
