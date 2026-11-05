import { randomBytes } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { chaveValida, criarCifra } from '../../src/bling/cifra.js';

// Chaves e tokens fictícios, gerados a cada execução.
const chave = () => randomBytes(32).toString('base64');
const TOKEN = 'token-ficticio-de-acesso-0123456789';

describe('criarCifra', () => {
  it('decifra o que cifrou', () => {
    const cifra = criarCifra(chave());
    expect(cifra.decifrar(cifra.cifrar(TOKEN))).toBe(TOKEN);
    expect(cifra.decifrar(cifra.cifrar(''))).toBe('');
    expect(cifra.decifrar(cifra.cifrar('ação ✓'))).toBe('ação ✓');
  });

  it('usa formato v1 com quatro partes em base64url e não guarda o texto em claro', () => {
    const cifrado = criarCifra(chave()).cifrar(TOKEN);
    expect(cifrado).toMatch(/^v1\.[\w-]+\.[\w-]+\.[\w-]+$/);
    expect(cifrado).not.toContain(TOKEN);
  });

  it('gera um IV diferente a cada chamada', () => {
    const cifra = criarCifra(chave());
    const a = cifra.cifrar(TOKEN);
    const b = cifra.cifrar(TOKEN);
    expect(a).not.toBe(b);
    expect(a.split('.')[1]).not.toBe(b.split('.')[1]);
  });

  it('lança com a tag ou os dados adulterados', () => {
    const cifra = criarCifra(chave());
    const [versao, iv, tag, dados] = cifra.cifrar(TOKEN).split('.') as [
      string,
      string,
      string,
      string,
    ];
    const inverter = (parte: string) => {
      const bytes = Buffer.from(parte, 'base64url');
      bytes[0] = bytes[0]! ^ 0xff;
      return bytes.toString('base64url');
    };
    expect(() => cifra.decifrar([versao, iv, inverter(tag), dados].join('.'))).toThrow(/decifrar/);
    expect(() => cifra.decifrar([versao, iv, tag, inverter(dados)].join('.'))).toThrow(/decifrar/);
  });

  it('lança com outra chave, sem mostrar o conteúdo no erro', () => {
    const cifrado = criarCifra(chave()).cifrar(TOKEN);
    const outra = criarCifra(chave());
    expect(() => outra.decifrar(cifrado)).toThrow(/decifrar/);
    expect(() => outra.decifrar(cifrado)).not.toThrow(TOKEN);
  });

  it('lança com formato inválido', () => {
    const cifra = criarCifra(chave());
    const valido = cifra.cifrar(TOKEN);
    expect(() => cifra.decifrar('')).toThrow(/formato/);
    expect(() => cifra.decifrar(TOKEN)).toThrow(/formato/);
    expect(() => cifra.decifrar(valido.replace(/^v1/, 'v2'))).toThrow(/formato/);
    expect(() => cifra.decifrar(`${valido}.extra`)).toThrow(/formato/);
    const [versao, , tag, dados] = valido.split('.');
    expect(() => cifra.decifrar([versao, 'AAAA', tag, dados].join('.'))).toThrow(/formato/);
  });

  it('exige chave de 32 bytes', () => {
    expect(() => criarCifra(randomBytes(16).toString('base64'))).toThrow(/32 bytes/);
    expect(() => criarCifra(randomBytes(33).toString('base64'))).toThrow(/32 bytes/);
    expect(() => criarCifra('')).toThrow(/32 bytes/);
    expect(chaveValida(chave())).toBe(true);
    expect(chaveValida('curta')).toBe(false);
  });
});
