import { randomBytes, scrypt, type ScryptOptions, timingSafeEqual } from 'node:crypto';

// Parâmetros da OWASP para o scrypt (N=2^15, r=8, p=3): ~32 MiB por hash.
const PARAMETROS = { N: 2 ** 15, r: 8, p: 3 } as const;
const MEMORIA_MAXIMA = 64 * 1024 * 1024;
const BYTES_SAL = 16;
const BYTES_HASH = 32;

// Limites para aceitar um hash gravado: evitam que um valor adulterado no banco trave a API.
const LIMITES = { N: 2 ** 20, r: 32, p: 16 } as const;
const BASE64URL = /^[A-Za-z0-9_-]+$/;

type Parametros = { N: number; r: number; p: number };

function derivar(senha: string, sal: Buffer, tamanho: number, parametros: Parametros) {
  const opcoes: ScryptOptions = { ...parametros, maxmem: MEMORIA_MAXIMA };
  return new Promise<Buffer>((resolve, reject) => {
    // NFKC: a mesma senha digitada em teclados diferentes gera o mesmo hash.
    scrypt(senha.normalize('NFKC'), sal, tamanho, opcoes, (erro, chave) =>
      erro ? reject(erro) : resolve(chave),
    );
  });
}

// Formato: scrypt$N$r$p$sal$hash (sal e hash em base64url).
export async function gerarHash(senha: string): Promise<string> {
  const sal = randomBytes(BYTES_SAL);
  const hash = await derivar(senha, sal, BYTES_HASH, PARAMETROS);
  const { N, r, p } = PARAMETROS;
  return ['scrypt', N, r, p, sal.toString('base64url'), hash.toString('base64url')].join('$');
}

function inteiro(texto: string | undefined, maximo: number): number | undefined {
  if (!texto || !/^\d{1,8}$/.test(texto)) return undefined;
  const valor = Number(texto);
  return valor >= 1 && valor <= maximo ? valor : undefined;
}

function bytes(texto: string | undefined, minimo: number): Buffer | undefined {
  if (!texto || !BASE64URL.test(texto)) return undefined;
  const valor = Buffer.from(texto, 'base64url');
  return valor.length >= minimo ? valor : undefined;
}

function interpretarHash(gravado: string) {
  const [algoritmo, textoN, textoR, textoP, textoSal, textoHash, ...resto] = gravado.split('$');
  if (algoritmo !== 'scrypt' || resto.length > 0) return undefined;

  const N = inteiro(textoN, LIMITES.N);
  const r = inteiro(textoR, LIMITES.r);
  const p = inteiro(textoP, LIMITES.p);
  const sal = bytes(textoSal, BYTES_SAL);
  const hash = bytes(textoHash, BYTES_HASH);
  // O scrypt exige N potência de 2 maior que 1.
  if (!N || N < 2 || (N & (N - 1)) !== 0 || !r || !p || !sal || !hash) return undefined;
  if (128 * N * r > MEMORIA_MAXIMA) return undefined;
  return { parametros: { N, r, p }, sal, hash };
}

// Hash malformado ou com parâmetros fora dos limites → false.
export async function conferirSenha(senha: string, gravado: string): Promise<boolean> {
  const partes = interpretarHash(gravado);
  if (!partes) return false;
  const calculado = await derivar(senha, partes.sal, partes.hash.length, partes.parametros);
  return timingSafeEqual(calculado, partes.hash);
}
