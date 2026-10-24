import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';

import type { Config } from '../config/env.js';
import { ensureDir } from '../utils/fs.js';
import type { ConfigEntrada, ConfigTela } from './api.js';

/** Configurações salvas pela tela do app (data/settings.json). A senha fica só cifrada. */
export type Settings = {
  blingUser?: string;
  /** Senha cifrada pelo sistema (safeStorage/DPAPI), em base64. */
  blingPasswordEnc?: string;
  destDir?: string;
  chromePath?: string;
};

/** Cifra da senha; no app é o `safeStorage` do Electron (atrelado ao usuário do Windows). */
export type Cifra = {
  disponivel(): boolean;
  cifrar(texto: string): string;
  decifrar(cifrado: string): string;
};

const texto = z.string().trim().optional().catch(undefined);
const settingsSchema = z.object({
  blingUser: texto,
  blingPasswordEnc: texto,
  destDir: texto,
  chromePath: texto,
});

/** Lê o arquivo de configurações; ausente ou inválido vale como vazio. */
export async function lerSettings(arquivo: string): Promise<Settings> {
  let conteudo: string;
  try {
    conteudo = await readFile(arquivo, 'utf8');
  } catch {
    return {};
  }
  try {
    const parsed = settingsSchema.safeParse(JSON.parse(conteudo));
    return parsed.success ? parsed.data : {};
  } catch {
    return {};
  }
}

export async function salvarSettings(arquivo: string, settings: Settings): Promise<void> {
  await ensureDir(path.dirname(arquivo));
  await writeFile(arquivo, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
}

/**
 * Sobrepõe as configurações da tela à configuração do ambiente (tela > .env > padrões).
 * Senha que não decifra (ex.: arquivo copiado de outra máquina) é ignorada.
 */
export function aplicarSettings(config: Config, settings: Settings, cifra: Cifra): Config {
  let password = config.bling.password;
  if (settings.blingPasswordEnc) {
    try {
      password = cifra.decifrar(settings.blingPasswordEnc);
    } catch {
      password = undefined;
    }
  }
  return {
    ...config,
    chromePath: settings.chromePath ?? config.chromePath,
    bling: {
      user: settings.blingUser ?? config.bling.user,
      password,
      boletosDir: settings.destDir ?? config.bling.boletosDir,
    },
  };
}

/** O que a tela mostra: nunca inclui a senha, só se há uma definida. */
export function paraTela(envConfig: Config, settings: Settings, cifra: Cifra): ConfigTela {
  const config = aplicarSettings(envConfig, settings, cifra);
  return {
    blingUser: config.bling.user ?? '',
    temSenha: Boolean(config.bling.password),
    destDir: config.bling.boletosDir,
    chromePath: settings.chromePath ?? '',
    chromePadrao: envConfig.chromePath,
  };
}

const entradaSchema = z.object({
  blingUser: z.string().trim().min(1, 'Informe o usuário do Bling.'),
  blingPassword: z.string().optional(),
  destDir: z.string().trim().min(1, 'Informe a pasta padrão dos documentos.'),
  chromePath: z.string().trim().optional(),
});

/**
 * Aplica o que veio da tela às configurações salvas. Senha vazia mantém a atual; caminho do Chrome
 * vazio volta ao padrão.
 */
export function atualizarSettings(atual: Settings, input: unknown, cifra: Cifra): Settings {
  const parsed = entradaSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? 'Configurações inválidas.');
  }
  const entrada: ConfigEntrada = parsed.data;
  const proximo: Settings = {
    ...atual,
    blingUser: entrada.blingUser,
    destDir: path.resolve(entrada.destDir),
    chromePath: entrada.chromePath || undefined,
  };
  if (entrada.blingPassword) {
    if (!cifra.disponivel()) {
      throw new Error('Não foi possível proteger a senha neste computador.');
    }
    proximo.blingPasswordEnc = cifra.cifrar(entrada.blingPassword);
  }
  return proximo;
}
