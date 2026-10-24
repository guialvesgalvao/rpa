import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  aplicarSettings,
  atualizarSettings,
  type Cifra,
  lerSettings,
  paraTela,
  salvarSettings,
} from '../../src/app/settings.js';
import { loadConfig } from '../../src/config/env.js';

const cifra: Cifra = {
  disponivel: () => true,
  cifrar: (texto) => `cifrado:${texto}`,
  decifrar: (cifrado) => {
    if (!cifrado.startsWith('cifrado:')) throw new Error('não decifra');
    return cifrado.slice('cifrado:'.length);
  },
};

const CHROME = String.raw`C:\chrome.exe`;

const envConfig = loadConfig(
  { BLING_USER: 'usuario-env', BLING_PASSWORD: 'senha-env', BLING_BOLETOS_DIR: 'boletos-env' },
  path.resolve('base'),
);

describe('aplicarSettings', () => {
  it('usa o .env quando não há configurações salvas', () => {
    const config = aplicarSettings(envConfig, {}, cifra);
    expect(config.bling).toEqual(envConfig.bling);
    expect(config.chromePath).toBe(envConfig.chromePath);
  });

  it('dá preferência às configurações da tela', () => {
    const destDir = path.resolve('destino');
    const config = aplicarSettings(
      envConfig,
      {
        blingUser: 'robo',
        blingPasswordEnc: 'cifrado:segredo',
        destDir,
        chromePath: CHROME,
      },
      cifra,
    );
    expect(config.bling).toEqual({ user: 'robo', password: 'segredo', boletosDir: destDir });
    expect(config.chromePath).toBe(CHROME);
  });

  it('descarta a senha que não decifra', () => {
    const config = aplicarSettings(envConfig, { blingPasswordEnc: 'de-outra-maquina' }, cifra);
    expect(config.bling.password).toBeUndefined();
  });
});

describe('atualizarSettings', () => {
  const entrada = { blingUser: ' robo ', blingPassword: 'segredo', destDir: 'pasta' };

  it('cifra a senha e resolve a pasta', () => {
    expect(atualizarSettings({}, entrada, cifra)).toEqual({
      blingUser: 'robo',
      blingPasswordEnc: 'cifrado:segredo',
      destDir: path.resolve('pasta'),
      chromePath: undefined,
    });
  });

  it('senha vazia mantém a atual e Chrome vazio volta ao padrão', () => {
    const atual = { blingPasswordEnc: 'cifrado:antiga', chromePath: CHROME };
    const proximo = atualizarSettings(
      atual,
      { ...entrada, blingPassword: '', chromePath: ' ' },
      cifra,
    );
    expect(proximo.blingPasswordEnc).toBe('cifrado:antiga');
    expect(proximo.chromePath).toBeUndefined();
  });

  it('rejeita entrada sem usuário ou pasta', () => {
    expect(() => atualizarSettings({}, { ...entrada, blingUser: ' ' }, cifra)).toThrow(
      'Informe o usuário do Bling.',
    );
    expect(() => atualizarSettings({}, { ...entrada, destDir: '' }, cifra)).toThrow(
      'Informe a pasta padrão dos documentos.',
    );
    expect(() => atualizarSettings({}, 'qualquer coisa', cifra)).toThrow();
  });

  it('não grava a senha quando a cifra não está disponível', () => {
    expect(() => atualizarSettings({}, entrada, { ...cifra, disponivel: () => false })).toThrow(
      /proteger a senha/,
    );
  });
});

describe('paraTela', () => {
  it('nunca expõe a senha e mostra o Chrome só quando definido na tela', () => {
    const tela = paraTela(envConfig, { blingPasswordEnc: 'cifrado:segredo' }, cifra);
    expect(tela).toEqual({
      blingUser: 'usuario-env',
      temSenha: true,
      destDir: envConfig.bling.boletosDir,
      chromePath: '',
      chromePadrao: envConfig.chromePath,
    });
    expect(JSON.stringify(tela)).not.toContain('segredo');
  });
});

describe('lerSettings / salvarSettings', () => {
  it('grava e lê de volta, criando a pasta', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'rpa-settings-'));
    const arquivo = path.join(dir, 'data', 'settings.json');
    await salvarSettings(arquivo, { blingUser: 'robo', blingPasswordEnc: 'cifrado:x' });
    expect(await lerSettings(arquivo)).toEqual({
      blingUser: 'robo',
      blingPasswordEnc: 'cifrado:x',
    });
  });

  it('arquivo ausente ou inválido vale como vazio', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'rpa-settings-'));
    expect(await lerSettings(path.join(dir, 'nao-existe.json'))).toEqual({});
    const invalido = path.join(dir, 'invalido.json');
    await writeFile(invalido, '{ não é json');
    expect(await lerSettings(invalido)).toEqual({});
  });
});
