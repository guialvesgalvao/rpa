import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';

import type { Config } from '../config/env.js';
import { ensureDir } from '../utils/fs.js';
import type { ConfigEntrada, ConfigTela } from './api.js';
import type { Perfil } from './plataforma/contratos.js';

/** Configuração do Bling de uma empresa, de um usuário. A senha fica só cifrada. */
export type SettingsEmpresa = {
  blingUser?: string;
  /** Senha cifrada pelo sistema (safeStorage/DPAPI), em base64. */
  blingPasswordEnc?: string;
  destDir?: string;
};

export type SettingsUsuario = {
  empresaAtual?: string;
  /** Por slug da empresa. */
  empresas: Record<string, SettingsEmpresa>;
};

/** Configurações salvas pela tela do app (data/settings.json, formato v2). */
export type Settings = {
  versao: 2;
  chromePath?: string;
  /** Por id do usuário na plataforma. */
  usuarios: Record<string, SettingsUsuario>;
};

/** Cifra da senha; no app é o `safeStorage` assíncrono do Electron (atrelado ao usuário do Windows). */
export type Cifra = {
  disponivel(): boolean;
  cifrar(texto: string): Promise<string>;
  decifrar(cifrado: string): Promise<string>;
};

const texto = z.string().trim().optional().catch(undefined);
const empresaSchema = z.object({
  blingUser: texto,
  blingPasswordEnc: texto,
  destDir: texto,
});
const usuarioSchema = z.object({
  empresaAtual: texto,
  empresas: z.record(z.string(), empresaSchema.catch({})).catch({}),
});
const settingsSchema = z.object({
  versao: z.literal(2),
  chromePath: texto,
  usuarios: z.record(z.string(), usuarioSchema.catch({ empresas: {} })).catch({}),
});

const vazio = (): Settings => ({ versao: 2, usuarios: {} });

/**
 * Lê o arquivo de configurações; ausente, inválido ou de outro formato (v1, sem `versao: 2`) vale
 * como vazio. O arquivo antigo não é apagado nem migrado: não tem dono, e herdar a senha do Bling
 * de outra pessoa seria um risco.
 */
export async function lerSettings(arquivo: string): Promise<Settings> {
  let conteudo: string;
  try {
    conteudo = await readFile(arquivo, 'utf8');
  } catch {
    return vazio();
  }
  try {
    const parsed = settingsSchema.safeParse(JSON.parse(conteudo));
    return parsed.success ? parsed.data : vazio();
  } catch {
    return vazio();
  }
}

export async function salvarSettings(arquivo: string, settings: Settings): Promise<void> {
  await ensureDir(path.dirname(arquivo));
  await writeFile(arquivo, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
}

/** Configuração do usuário nesta empresa (vazia se ainda não há). */
export function settingsDaEmpresa(
  settings: Settings,
  usuarioId: string,
  empresa: string,
): SettingsEmpresa {
  const usuario = Object.hasOwn(settings.usuarios, usuarioId)
    ? settings.usuarios[usuarioId]
    : undefined;
  return usuario && Object.hasOwn(usuario.empresas, empresa) ? usuario.empresas[empresa]! : {};
}

/**
 * Empresa em uso: a última escolhida pelo usuário, se ainda for dele; senão a primeira.
 * `undefined` quando o usuário não tem empresa.
 */
export function empresaAtual(
  settings: Settings,
  usuarioId: string,
  slugs: readonly string[],
): string | undefined {
  const salva = Object.hasOwn(settings.usuarios, usuarioId)
    ? settings.usuarios[usuarioId]?.empresaAtual
    : undefined;
  return salva && slugs.includes(salva) ? salva : slugs[0];
}

/** Grava a empresa em uso do usuário. Devolve uma cópia; quem chama valida o slug contra o perfil. */
export function definirEmpresaAtual(atual: Settings, usuarioId: string, empresa: string): Settings {
  const usuario = Object.hasOwn(atual.usuarios, usuarioId)
    ? atual.usuarios[usuarioId]!
    : { empresas: {} };
  return {
    ...atual,
    usuarios: { ...atual.usuarios, [usuarioId]: { ...usuario, empresaAtual: empresa } },
  };
}

/**
 * Falta preencher a configuração desta empresa? O admin precisa de usuário, senha e pasta; o arte
 * finalista nunca configura o Bling.
 */
export function faltaConfig(perfil: Perfil, cfgEmpresa: SettingsEmpresa | undefined): boolean {
  if (perfil !== 'admin') return false;
  return !cfgEmpresa?.blingUser || !cfgEmpresa.blingPasswordEnc || !cfgEmpresa.destDir;
}

// Slug e id vêm da API (ou do cache em disco) e viram nome de pasta: nada de separadores ou "..".
const segmentoSeguro = /^[\w-]+$/;

/** Pasta do perfil do Chrome: `<dados>/chrome/<usuarioId>/<empresa>`. */
export function pastaChrome(dirDados: string, usuarioId: string, empresa: string): string {
  if (!segmentoSeguro.test(usuarioId) || !segmentoSeguro.test(empresa)) {
    throw new Error('Identificação de usuário ou empresa inválida.');
  }
  return path.join(dirDados, 'chrome', usuarioId, empresa);
}

/**
 * Monta a configuração da execução para este usuário e empresa (tela > .env > padrões). As
 * credenciais do Bling vêm só da empresa: não herdam o `.env`, para uma empresa nunca usar a conta
 * de outra. O perfil do Chrome é por usuário e empresa e sobrepõe `CHROME_PROFILE_DIR`. Senha que
 * não decifra (ex.: arquivo copiado de outra máquina) é ignorada.
 */
export async function configAtual(
  envConfig: Config,
  settings: Settings,
  usuarioId: string,
  empresa: string,
  dirDados: string,
  cifra: Cifra,
): Promise<Config> {
  const cfg = settingsDaEmpresa(settings, usuarioId, empresa);
  let password: string | undefined;
  if (cfg.blingPasswordEnc) {
    try {
      password = await cifra.decifrar(cfg.blingPasswordEnc);
    } catch {
      password = undefined;
    }
  }
  return {
    ...envConfig,
    chromePath: settings.chromePath ?? envConfig.chromePath,
    profileDir: pastaChrome(dirDados, usuarioId, empresa),
    bling: {
      user: cfg.blingUser,
      password,
      boletosDir: cfg.destDir ?? envConfig.bling.boletosDir,
    },
  };
}

/** O que a tela mostra: nunca inclui a senha, só se há uma definida. */
export async function paraTela(
  envConfig: Config,
  settings: Settings,
  usuarioId: string,
  empresa: string,
  dirDados: string,
  cifra: Cifra,
): Promise<ConfigTela> {
  const config = await configAtual(envConfig, settings, usuarioId, empresa, dirDados, cifra);
  return {
    blingUser: config.bling.user ?? '',
    temSenha: Boolean(config.bling.password),
    destDir: config.bling.boletosDir,
    chromePath: settings.chromePath ?? '',
    chromePadrao: envConfig.chromePath,
    // Esta tela só existe para o admin.
    falta: faltaConfig('admin', settingsDaEmpresa(settings, usuarioId, empresa)),
  };
}

const entradaSchema = z.object({
  blingUser: z.string().trim().min(1, 'Informe o usuário do Bling.'),
  blingPassword: z.string().optional(),
  destDir: z.string().trim().min(1, 'Informe a pasta padrão dos documentos.'),
  chromePath: z.string().trim().optional(),
});

/**
 * Aplica o que veio da tela às configurações salvas do usuário nesta empresa. Senha vazia mantém a
 * atual, mas é obrigatória no primeiro salvamento da empresa; caminho do Chrome vazio volta ao
 * padrão. Devolve uma cópia; `atual` não é alterado.
 */
export async function atualizarSettings(
  atual: Settings,
  usuarioId: string,
  empresa: string,
  input: unknown,
  cifra: Cifra,
): Promise<Settings> {
  const parsed = entradaSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? 'Configurações inválidas.');
  }
  const entrada: ConfigEntrada = parsed.data;
  const anterior = settingsDaEmpresa(atual, usuarioId, empresa);
  const proxima: SettingsEmpresa = {
    ...anterior,
    blingUser: entrada.blingUser,
    destDir: path.resolve(entrada.destDir),
  };
  if (entrada.blingPassword) {
    if (!cifra.disponivel()) {
      throw new Error('Não foi possível proteger a senha neste computador.');
    }
    proxima.blingPasswordEnc = await cifra.cifrar(entrada.blingPassword);
  } else if (!anterior.blingPasswordEnc) {
    throw new Error('Informe a senha do Bling.');
  }
  const usuario = Object.hasOwn(atual.usuarios, usuarioId)
    ? atual.usuarios[usuarioId]!
    : { empresas: {} };
  return {
    ...atual,
    chromePath: entrada.chromePath || undefined,
    usuarios: {
      ...atual.usuarios,
      [usuarioId]: { ...usuario, empresas: { ...usuario.empresas, [empresa]: proxima } },
    },
  };
}
