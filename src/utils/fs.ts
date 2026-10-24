import { mkdir } from 'node:fs/promises';
import path from 'node:path';

/**
 * Converte caminho do Windows (C:\Users\x) para o equivalente no WSL (/mnt/c/Users/x).
 * Rodando nativo no Windows, o caminho é mantido.
 */
export function toWslPath(input: string, platform: NodeJS.Platform = process.platform): string {
  if (platform === 'win32') return input.trim();
  const match = /^([a-zA-Z]):[\\/](.*)$/.exec(input.trim());
  if (!match) return input.trim();
  const [, drive = '', rest = ''] = match;
  return path.posix.join('/mnt', drive.toLowerCase(), rest.replace(/\\/g, '/'));
}

/** Remove caracteres inválidos em nomes de arquivo no Windows. */
export function safeFileName(name: string): string {
  const cleaned = name
    // eslint-disable-next-line no-control-regex -- caracteres de controle são inválidos no Windows
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '');
  return cleaned || 'arquivo';
}

/** Ex.: timestampedName('relatorio', '.pdf') → relatorio_2026-10-08T14-30-00.pdf */
export function timestampedName(base: string, ext: string, date = new Date()): string {
  const stamp = date.toISOString().slice(0, 19).replace(/:/g, '-');
  return `${safeFileName(base)}_${stamp}${ext}`;
}

export async function ensureDir(dir: string): Promise<string> {
  await mkdir(dir, { recursive: true });
  return dir;
}
