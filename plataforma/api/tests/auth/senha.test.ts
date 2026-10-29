import { scryptSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { conferirSenha, gerarHash } from '../../src/auth/senha.js';

const SENHA = 'senha-ficticia-123';

describe('gerarHash', () => {
  it('gera o formato scrypt$N$r$p$sal$hash com os parâmetros da OWASP', async () => {
    const hash = await gerarHash(SENHA);
    const [algoritmo, N, r, p, sal, valor, ...resto] = hash.split('$');

    expect([algoritmo, N, r, p]).toEqual(['scrypt', '32768', '8', '3']);
    expect(Buffer.from(sal ?? '', 'base64url')).toHaveLength(16);
    expect(Buffer.from(valor ?? '', 'base64url')).toHaveLength(32);
    expect(resto).toEqual([]);
    expect(hash).not.toContain(SENHA);
  });

  it('usa um sal novo a cada hash', async () => {
    expect(await gerarHash(SENHA)).not.toBe(await gerarHash(SENHA));
  });
});

describe('conferirSenha', () => {
  it('aceita a senha certa e recusa a errada', async () => {
    const hash = await gerarHash(SENHA);
    expect(await conferirSenha(SENHA, hash)).toBe(true);
    expect(await conferirSenha(`${SENHA}x`, hash)).toBe(false);
    expect(await conferirSenha('', hash)).toBe(false);
  });

  it('trata formas Unicode equivalentes como a mesma senha', async () => {
    const composta = 'senha-ação-123';
    const decomposta = composta.normalize('NFD');
    expect(decomposta).not.toBe(composta);
    expect(await conferirSenha(decomposta, await gerarHash(composta))).toBe(true);
  });

  it('confere hashes gravados com outros parâmetros válidos', async () => {
    const sal = Buffer.alloc(16, 7);
    const valor = scryptSync(SENHA, sal, 64, { N: 1024, r: 8, p: 1 });
    const hash = ['scrypt', 1024, 8, 1, sal.toString('base64url'), valor.toString('base64url')];
    expect(await conferirSenha(SENHA, hash.join('$'))).toBe(true);
    expect(await conferirSenha(`${SENHA}x`, hash.join('$'))).toBe(false);
  });

  it.each([
    ['vazio', ''],
    ['texto qualquer', 'nao-e-um-hash'],
    [
      'outro algoritmo',
      'bcrypt$32768$8$3$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    ],
    [
      'N não potência de 2',
      'scrypt$1000$8$3$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    ],
    [
      'N acima do limite',
      'scrypt$4194304$8$3$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    ],
    [
      'memória acima do limite',
      'scrypt$131072$8$1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    ],
    [
      'p zero',
      'scrypt$32768$8$0$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    ],
    ['sal curto', 'scrypt$32768$8$3$AAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'],
    [
      'hash com caractere inválido',
      'scrypt$32768$8$3$AAAAAAAAAAAAAAAAAAAAAA$AAAA+AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    ],
    [
      'campo a mais',
      'scrypt$32768$8$3$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA$x',
    ],
  ])('recusa hash malformado (%s)', async (_caso, hash) => {
    expect(await conferirSenha(SENHA, hash)).toBe(false);
  });
});
