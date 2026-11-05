import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITMO = 'aes-256-gcm';
const VERSAO = 'v1';
const BYTES_CHAVE = 32;
const BYTES_IV = 12;
const BYTES_TAG = 16;

export type Cifra = {
  // `v1.<iv>.<tag>.<dados>`, cada parte em base64url; o IV é aleatório a cada chamada.
  cifrar(texto: string): string;
  // Lança se o formato, a tag ou a chave não baterem. A mensagem nunca traz o conteúdo.
  decifrar(cifrado: string): string;
};

export function chaveValida(chaveBase64: string): boolean {
  return Buffer.from(chaveBase64, 'base64').length === BYTES_CHAVE;
}

export function criarCifra(chaveBase64: string): Cifra {
  const chave = Buffer.from(chaveBase64, 'base64');
  if (chave.length !== BYTES_CHAVE)
    throw new Error(`A chave dos tokens do Bling precisa ter ${BYTES_CHAVE} bytes em base64.`);

  return {
    cifrar(texto) {
      const iv = randomBytes(BYTES_IV);
      const cifra = createCipheriv(ALGORITMO, chave, iv);
      const dados = Buffer.concat([cifra.update(texto, 'utf8'), cifra.final()]);
      const tag = cifra.getAuthTag();
      return [VERSAO, iv, tag, dados]
        .map((parte) => (typeof parte === 'string' ? parte : parte.toString('base64url')))
        .join('.');
    },

    decifrar(cifrado) {
      const partes = cifrado.split('.');
      if (partes.length !== 4 || partes[0] !== VERSAO)
        throw new Error('Token do Bling cifrado em formato inválido.');
      const [iv, tag, dados] = partes.slice(1).map((parte) => Buffer.from(parte, 'base64url')) as [
        Buffer,
        Buffer,
        Buffer,
      ];
      if (iv.length !== BYTES_IV || tag.length !== BYTES_TAG)
        throw new Error('Token do Bling cifrado em formato inválido.');

      const decifra = createDecipheriv(ALGORITMO, chave, iv);
      decifra.setAuthTag(tag);
      try {
        return Buffer.concat([decifra.update(dados), decifra.final()]).toString('utf8');
      } catch {
        throw new Error('Não foi possível decifrar o token do Bling (chave ou dados inválidos).');
      }
    },
  };
}
