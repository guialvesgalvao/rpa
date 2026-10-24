import { access } from 'node:fs/promises';
import path from 'node:path';

import { safeFileName } from '../../utils/fs.js';

const doisDigitos = (n: number): string => String(n).padStart(2, '0');

const diaMes = (d: Date): string => `${doisDigitos(d.getDate())} ${doisDigitos(d.getMonth() + 1)}`;

/** Ex.: 25/10/2026 → "25 10 26". Usa a data local, nunca UTC. */
export function formatarData(d: Date): string {
  return `${diaMes(d)} ${doisDigitos(d.getFullYear() % 100)}`;
}

/** Ex.: [25/10, 01/11, 15/11/2026] → "25 10 - 01 11 - 15 11 26". O ano vai só no fim, o da última parcela. */
export function formatarParcelas(datas: Date[]): string {
  const ultima = datas.at(-1);
  if (!ultima) throw new Error('Pedido sem parcelas');
  return `${datas.map(diaMes).join(' - ')} ${doisDigitos(ultima.getFullYear() % 100)}`;
}

const pdf = (base: string): string => `${safeFileName(base)}.pdf`;

/** Ex.: "Boleto Cliente 25 10 26.pdf" (um arquivo por parcela). */
export function nomeBoleto(cliente: string, vencimento: Date): string {
  return pdf(`Boleto ${cliente} ${formatarData(vencimento)}`);
}

/** Ex.: "Recibo Cliente 25 10 - 01 11 26.pdf". */
export function nomeRecibo(cliente: string, parcelas: Date[]): string {
  return pdf(`Recibo ${cliente} ${formatarParcelas(parcelas)}`);
}

/** Ex.: "NF 1234 Cliente 25 10 - 01 11 26.pdf". */
export function nomeNf(numeroNf: string, cliente: string, parcelas: Date[]): string {
  return pdf(`NF ${numeroNf} ${cliente} ${formatarParcelas(parcelas)}`);
}

async function existe(arquivo: string): Promise<boolean> {
  try {
    await access(arquivo);
    return true;
  } catch {
    return false;
  }
}

/** Caminho em `dir` que ainda não existe: "nome.pdf", senão "nome (2).pdf", "nome (3).pdf"… */
export async function caminhoLivre(dir: string, nome: string): Promise<string> {
  const { name, ext } = path.parse(nome);
  let candidato = path.join(dir, nome);
  for (let i = 2; await existe(candidato); i++) {
    candidato = path.join(dir, `${name} (${i})${ext}`);
  }
  return candidato;
}
