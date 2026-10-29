import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  atualizarSettings,
  type Cifra,
  configAtual,
  definirEmpresaAtual,
  empresaAtual,
  faltaConfig,
  lerSettings,
  paraTela,
  pastaChrome,
  salvarSettings,
  type Settings,
} from '../../src/app/settings.js';
import { loadConfig } from '../../src/config/env.js';

const cifra: Cifra = {
  disponivel: () => true,
  cifrar: async (texto) => `cifrado:${texto}`,
  decifrar: async (cifrado) => {
    if (!cifrado.startsWith('cifrado:')) throw new Error('não decifra');
    return cifrado.slice('cifrado:'.length);
  },
};

const CHROME = String.raw`C:\chrome.exe`;
const DADOS = path.resolve('dados');
const ANA = '11111111-1111-4111-8111-111111111111';
const BETO = '22222222-2222-4222-8222-222222222222';

const envConfig = loadConfig(
  { BLING_USER: 'usuario-env', BLING_PASSWORD: 'senha-env', BLING_BOLETOS_DIR: 'boletos-env' },
  path.resolve('base'),
);

const vazio: Settings = { versao: 2, usuarios: {} };
const entrada = { blingUser: ' robo ', blingPassword: 'segredo', destDir: 'pasta' };

describe('configAtual', () => {
  it('não herda o .env: sem configuração da empresa não há usuário nem senha', async () => {
    const config = await configAtual(envConfig, vazio, ANA, 'aba', DADOS, cifra);
    expect(config.bling).toEqual({
      user: undefined,
      password: undefined,
      boletosDir: envConfig.bling.boletosDir,
    });
    expect(config.chromePath).toBe(envConfig.chromePath);
  });

  it('usa a configuração salva da empresa e o Chrome definido na tela', async () => {
    const destDir = path.resolve('destino');
    const settings: Settings = {
      versao: 2,
      chromePath: CHROME,
      usuarios: {
        [ANA]: {
          empresas: { aba: { blingUser: 'robo', blingPasswordEnc: 'cifrado:segredo', destDir } },
        },
      },
    };
    const config = await configAtual(envConfig, settings, ANA, 'aba', DADOS, cifra);
    expect(config.bling).toEqual({ user: 'robo', password: 'segredo', boletosDir: destDir });
    expect(config.chromePath).toBe(CHROME);
  });

  it('descarta a senha que não decifra', async () => {
    const settings: Settings = {
      versao: 2,
      usuarios: { [ANA]: { empresas: { aba: { blingPasswordEnc: 'de-outra-maquina' } } } },
    };
    const config = await configAtual(envConfig, settings, ANA, 'aba', DADOS, cifra);
    expect(config.bling.password).toBeUndefined();
  });

  it('usa um perfil do Chrome por usuário e empresa, sobrepondo o .env', async () => {
    const aba = await configAtual(envConfig, vazio, ANA, 'aba', DADOS, cifra);
    const roma = await configAtual(envConfig, vazio, ANA, 'roma', DADOS, cifra);
    const outro = await configAtual(envConfig, vazio, BETO, 'aba', DADOS, cifra);
    expect(aba.profileDir).toBe(path.join(DADOS, 'chrome', ANA, 'aba'));
    expect(new Set([aba.profileDir, roma.profileDir, outro.profileDir]).size).toBe(3);
    expect(aba.profileDir).not.toBe(envConfig.profileDir);
  });
});

describe('pastaChrome', () => {
  it('rejeita id ou empresa que escapem da pasta', () => {
    expect(() => pastaChrome(DADOS, ANA, '../aba')).toThrow();
    expect(() => pastaChrome(DADOS, `..${path.sep}x`, 'aba')).toThrow();
    expect(() => pastaChrome(DADOS, ANA, '')).toThrow();
  });
});

describe('atualizarSettings', () => {
  it('cifra a senha e resolve a pasta, na empresa do usuário', async () => {
    const proximo = await atualizarSettings(vazio, ANA, 'aba', entrada, cifra);
    expect(proximo).toEqual({
      versao: 2,
      chromePath: undefined,
      usuarios: {
        [ANA]: {
          empresas: {
            aba: {
              blingUser: 'robo',
              blingPasswordEnc: 'cifrado:segredo',
              destDir: path.resolve('pasta'),
            },
          },
        },
      },
    });
    expect(vazio).toEqual({ versao: 2, usuarios: {} });
  });

  it('isola usuários e empresas', async () => {
    let settings = await atualizarSettings(vazio, ANA, 'aba', entrada, cifra);
    settings = await atualizarSettings(
      settings,
      ANA,
      'roma',
      { ...entrada, blingUser: 'roma-robo', blingPassword: 'roma-senha' },
      cifra,
    );
    settings = await atualizarSettings(
      settings,
      BETO,
      'aba',
      { ...entrada, blingUser: 'beto', blingPassword: 'beto-senha' },
      cifra,
    );
    const ler = async (usuario: string, empresa: string) =>
      (await configAtual(envConfig, settings, usuario, empresa, DADOS, cifra)).bling;
    expect(await ler(ANA, 'aba')).toMatchObject({ user: 'robo', password: 'segredo' });
    expect(await ler(ANA, 'roma')).toMatchObject({ user: 'roma-robo', password: 'roma-senha' });
    expect(await ler(BETO, 'aba')).toMatchObject({ user: 'beto', password: 'beto-senha' });
    expect(await ler(BETO, 'roma')).toMatchObject({ user: undefined, password: undefined });
  });

  it('senha vazia mantém a atual e Chrome vazio volta ao padrão', async () => {
    const atual: Settings = {
      versao: 2,
      chromePath: CHROME,
      usuarios: { [ANA]: { empresas: { aba: { blingPasswordEnc: 'cifrado:antiga' } } } },
    };
    const proximo = await atualizarSettings(
      atual,
      ANA,
      'aba',
      { ...entrada, blingPassword: '', chromePath: ' ' },
      cifra,
    );
    expect(proximo.usuarios[ANA]?.empresas.aba?.blingPasswordEnc).toBe('cifrado:antiga');
    expect(proximo.chromePath).toBeUndefined();
  });

  it('exige a senha no primeiro salvamento da empresa', async () => {
    await expect(
      atualizarSettings(vazio, ANA, 'aba', { ...entrada, blingPassword: '' }, cifra),
    ).rejects.toThrow('Informe a senha do Bling.');
    // A senha de outra empresa não vale para esta.
    const comAba = await atualizarSettings(vazio, ANA, 'aba', entrada, cifra);
    await expect(
      atualizarSettings(comAba, ANA, 'roma', { ...entrada, blingPassword: '' }, cifra),
    ).rejects.toThrow('Informe a senha do Bling.');
  });

  it('rejeita entrada sem usuário ou pasta', async () => {
    await expect(
      atualizarSettings(vazio, ANA, 'aba', { ...entrada, blingUser: ' ' }, cifra),
    ).rejects.toThrow('Informe o usuário do Bling.');
    await expect(
      atualizarSettings(vazio, ANA, 'aba', { ...entrada, destDir: '' }, cifra),
    ).rejects.toThrow('Informe a pasta padrão dos documentos.');
    await expect(atualizarSettings(vazio, ANA, 'aba', 'qualquer coisa', cifra)).rejects.toThrow();
  });

  it('não grava a senha quando a cifra não está disponível', async () => {
    await expect(
      atualizarSettings(vazio, ANA, 'aba', entrada, { ...cifra, disponivel: () => false }),
    ).rejects.toThrow(/proteger a senha/);
  });
});

describe('faltaConfig', () => {
  const completa = { blingUser: 'robo', blingPasswordEnc: 'cifrado:x', destDir: 'pasta' };

  it('admin precisa de usuário, senha e pasta', () => {
    expect(faltaConfig('admin', completa)).toBe(false);
    expect(faltaConfig('admin', undefined)).toBe(true);
    expect(faltaConfig('admin', { ...completa, blingUser: undefined })).toBe(true);
    expect(faltaConfig('admin', { ...completa, blingPasswordEnc: undefined })).toBe(true);
    expect(faltaConfig('admin', { ...completa, destDir: undefined })).toBe(true);
  });

  it('arte finalista nunca precisa', () => {
    expect(faltaConfig('arte_finalista', undefined)).toBe(false);
    expect(faltaConfig('arte_finalista', {})).toBe(false);
  });
});

describe('empresaAtual', () => {
  const settings: Settings = {
    versao: 2,
    usuarios: { [ANA]: { empresaAtual: 'roma', empresas: {} } },
  };

  it('usa a empresa salva se ainda for do usuário; senão a primeira', () => {
    expect(empresaAtual(settings, ANA, ['aba', 'roma'])).toBe('roma');
    expect(empresaAtual(settings, ANA, ['aba'])).toBe('aba');
    expect(empresaAtual(settings, BETO, ['aba', 'roma'])).toBe('aba');
    expect(empresaAtual(settings, ANA, [])).toBeUndefined();
  });
});

describe('paraTela', () => {
  it('nunca expõe a senha e mostra o Chrome só quando definido na tela', async () => {
    const settings: Settings = {
      versao: 2,
      usuarios: {
        [ANA]: {
          empresas: { aba: { blingUser: 'robo', blingPasswordEnc: 'cifrado:segredo' } },
        },
      },
    };
    const tela = await paraTela(envConfig, settings, ANA, 'aba', DADOS, cifra);
    expect(tela).toEqual({
      blingUser: 'robo',
      temSenha: true,
      destDir: envConfig.bling.boletosDir,
      chromePath: '',
      chromePadrao: envConfig.chromePath,
      falta: true,
    });
    expect(JSON.stringify(tela)).not.toContain('segredo');
  });

  it('não mostra a configuração de outro usuário', async () => {
    const settings = await atualizarSettings(vazio, ANA, 'aba', entrada, cifra);
    const tela = await paraTela(envConfig, settings, BETO, 'aba', DADOS, cifra);
    expect(tela).toMatchObject({ blingUser: '', temSenha: false, falta: true });
  });
});

describe('paraTela.falta', () => {
  it('só some quando a empresa tem usuário, senha e pasta', async () => {
    const settings = await atualizarSettings(vazio, ANA, 'aba', entrada, cifra);
    expect((await paraTela(envConfig, settings, ANA, 'aba', DADOS, cifra)).falta).toBe(false);
    expect((await paraTela(envConfig, settings, ANA, 'roma', DADOS, cifra)).falta).toBe(true);
  });
});

describe('definirEmpresaAtual', () => {
  it('grava a empresa em uso sem mexer nas configurações nem nos outros usuários', async () => {
    const base = await atualizarSettings(vazio, ANA, 'aba', entrada, cifra);
    const outro = await atualizarSettings(base, BETO, 'aba', entrada, cifra);
    const settings = definirEmpresaAtual(outro, ANA, 'roma');
    expect(empresaAtual(settings, ANA, ['aba', 'roma'])).toBe('roma');
    expect(empresaAtual(settings, BETO, ['aba', 'roma'])).toBe('aba');
    expect(settings.usuarios[ANA]?.empresas).toEqual(base.usuarios[ANA]?.empresas);
    expect(empresaAtual(outro, ANA, ['aba', 'roma'])).toBe('aba');
  });

  it('cria o usuário se ainda não há', () => {
    expect(definirEmpresaAtual(vazio, ANA, 'roma').usuarios[ANA]).toEqual({
      empresaAtual: 'roma',
      empresas: {},
    });
  });
});

describe('lerSettings / salvarSettings', () => {
  it('grava e lê de volta, criando a pasta', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'rpa-settings-'));
    const arquivo = path.join(dir, 'data', 'settings.json');
    const settings = await atualizarSettings(vazio, ANA, 'aba', entrada, cifra);
    await salvarSettings(arquivo, settings);
    expect(await lerSettings(arquivo)).toEqual(settings);
  });

  it('arquivo ausente ou inválido vale como vazio', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'rpa-settings-'));
    expect(await lerSettings(path.join(dir, 'nao-existe.json'))).toEqual(vazio);
    const invalido = path.join(dir, 'invalido.json');
    await writeFile(invalido, '{ não é json');
    expect(await lerSettings(invalido)).toEqual(vazio);
  });

  it('ignora o formato v1 sem apagá-lo', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'rpa-settings-'));
    const arquivo = path.join(dir, 'settings.json');
    const v1 = JSON.stringify({ blingUser: 'robo', blingPasswordEnc: 'x', destDir: 'pasta' });
    await writeFile(arquivo, v1);
    expect(await lerSettings(arquivo)).toEqual(vazio);
    expect(await readFile(arquivo, 'utf8')).toBe(v1);
  });

  it('entrada malformada de um usuário não derruba o resto', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'rpa-settings-'));
    const arquivo = path.join(dir, 'settings.json');
    await writeFile(
      arquivo,
      JSON.stringify({
        versao: 2,
        usuarios: { [ANA]: 'lixo', [BETO]: { empresas: { aba: { blingUser: 'beto' } } } },
      }),
    );
    const lido = await lerSettings(arquivo);
    expect(lido.usuarios[ANA]).toEqual({ empresas: {} });
    expect(lido.usuarios[BETO]?.empresas.aba?.blingUser).toBe('beto');
  });
});
