import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  type ClientePlataforma,
  ErroIndisponivel,
  ErroRecusado,
} from '../../../src/app/plataforma/cliente.js';
import type { Eu } from '../../../src/app/plataforma/contratos.js';
import { type CifraSessao, criarSessao } from '../../../src/app/plataforma/sessao.js';

const EU: Eu = {
  id: '3f0c6d2e-8a41-4b5e-9d3a-1c2b3d4e5f60',
  nome: 'Usuário Teste',
  email: 'teste@example.com',
  perfil: 'admin',
  empresas: [{ slug: 'aba', nome: 'ABA' }],
};

const cifra: CifraSessao = {
  disponivel: () => true,
  cifrar: async (texto) => `cifrado:${texto}`,
  decifrar: async (cifrado) => {
    if (!cifrado.startsWith('cifrado:')) throw new Error('não decifra');
    return cifrado.slice('cifrado:'.length);
  },
};

const existe = (arquivo: string) =>
  stat(arquivo).then(
    () => true,
    () => false,
  );

/** Cliente falso: cada `renovar` devolve `acesso-N`/`renovacao-N`, válidos por 15 minutos. */
function clienteFalso(relogio: { agora: number }) {
  const estado = {
    renovacoes: [] as string[],
    saidas: [] as string[],
    entrarErro: undefined as Error | undefined,
    renovarErro: undefined as Error | undefined,
    eu: EU,
    euErro: undefined as Error | undefined,
    sairErro: undefined as Error | undefined,
  };
  let n = 0;
  const emitir = () => {
    n += 1;
    return {
      acesso: `acesso-${n}`,
      renovacao: `renovacao-${n}`,
      expiraEm: new Date(relogio.agora + 15 * 60_000).toISOString(),
    };
  };
  const cliente: ClientePlataforma = {
    async entrar() {
      if (estado.entrarErro) throw estado.entrarErro;
      return { ...emitir(), eu: estado.eu };
    },
    async renovar(renovacao) {
      estado.renovacoes.push(renovacao);
      if (estado.renovarErro) throw estado.renovarErro;
      return emitir();
    },
    async sair(renovacao) {
      estado.saidas.push(renovacao);
      if (estado.sairErro) throw estado.sairErro;
    },
    async eu() {
      if (estado.euErro) throw estado.euErro;
      return estado.eu;
    },
  };
  return { cliente, estado };
}

describe('criarSessao', () => {
  let arquivo: string;
  let relogio: { agora: number };

  beforeEach(async () => {
    arquivo = path.join(await mkdtemp(path.join(os.tmpdir(), 'rpa-sessao-')), 'data', 'sessao.json');
    relogio = { agora: Date.parse('2030-01-01T00:00:00.000Z') };
  });

  const montar = () => {
    const { cliente, estado } = clienteFalso(relogio);
    const sessao = criarSessao({ cliente, cifra, arquivo, relogio: () => new Date(relogio.agora) });
    return { sessao, estado };
  };

  it('entrar grava o token de renovação cifrado e o perfil em cache', async () => {
    const { sessao } = montar();

    const estado = await sessao.entrar('teste@example.com', 'segredo');

    expect(estado).toEqual({ situacao: 'online', perfil: EU });
    const salvo = JSON.parse(await readFile(arquivo, 'utf8'));
    expect(salvo.renovacaoEnc).toBe('cifrado:renovacao-1');
    expect(salvo.perfil).toEqual(EU);
    expect(await readFile(arquivo, 'utf8')).not.toContain('"renovacao-1"');
    expect(await sessao.obterAcesso()).toBe('acesso-1');
  });

  it('entrar não guarda nada quando a cifra do sistema está indisponível', async () => {
    const { cliente } = clienteFalso(relogio);
    const sessao = criarSessao({
      cliente,
      cifra: { ...cifra, disponivel: () => false },
      arquivo,
      relogio: () => new Date(relogio.agora),
    });

    await expect(sessao.entrar('a@b.com', 'x')).rejects.toThrow(/Cifra/);
    expect(sessao.estado()).toEqual({ situacao: 'deslogado' });
    expect(await existe(arquivo)).toBe(false);
  });

  it('entrar com credenciais recusadas propaga o erro e segue deslogado', async () => {
    const { sessao, estado } = montar();
    estado.entrarErro = new ErroRecusado(401, 'credenciais_invalidas', 'inválidas');

    await expect(sessao.entrar('a@b.com', 'x')).rejects.toBeInstanceOf(ErroRecusado);
    expect(sessao.estado()).toEqual({ situacao: 'deslogado' });
    expect(await existe(arquivo)).toBe(false);
  });

  it('iniciar renova com o token salvo e rotaciona o arquivo', async () => {
    await montar().sessao.entrar('teste@example.com', 'segredo');

    const { sessao, estado } = montar();
    const resultado = await sessao.iniciar();

    expect(resultado).toEqual({ situacao: 'online', perfil: EU });
    expect(estado.renovacoes).toEqual(['renovacao-1']);
    expect(JSON.parse(await readFile(arquivo, 'utf8')).renovacaoEnc).toBe('cifrado:renovacao-1');
    expect(await sessao.obterAcesso()).toBe('acesso-1');
  });

  it('iniciar atualiza o perfil em cache com o do servidor', async () => {
    await montar().sessao.entrar('teste@example.com', 'segredo');

    const { sessao, estado } = montar();
    const novo: Eu = { ...EU, perfil: 'arte_finalista' };
    estado.eu = novo;
    await sessao.iniciar();

    expect(sessao.estado()).toEqual({ situacao: 'online', perfil: novo });
    expect(JSON.parse(await readFile(arquivo, 'utf8')).perfil).toEqual(novo);
  });

  it('iniciar com rede caída fica offline com o perfil em cache e mantém a sessão salva', async () => {
    await montar().sessao.entrar('teste@example.com', 'segredo');

    const { sessao, estado } = montar();
    estado.renovarErro = new ErroIndisponivel('sem rede');
    const resultado = await sessao.iniciar();

    expect(resultado).toEqual({ situacao: 'offline', perfil: EU });
    expect(await existe(arquivo)).toBe(true);
    expect(await sessao.obterAcesso()).toBeUndefined();
  });

  it('offline volta a ficar online quando o servidor responde de novo', async () => {
    await montar().sessao.entrar('teste@example.com', 'segredo');

    const { sessao, estado } = montar();
    estado.renovarErro = new ErroIndisponivel('sem rede');
    await sessao.iniciar();
    estado.renovarErro = undefined;

    expect(await sessao.obterAcesso()).toBe('acesso-1');
    expect(sessao.estado().situacao).toBe('online');
  });

  it('iniciar com 401 na renovação apaga a sessão e fica deslogado', async () => {
    await montar().sessao.entrar('teste@example.com', 'segredo');

    const { sessao, estado } = montar();
    estado.renovarErro = new ErroRecusado(401, 'sessao_invalida', 'expirada');
    const resultado = await sessao.iniciar();

    expect(resultado).toEqual({ situacao: 'deslogado' });
    expect(await existe(arquivo)).toBe(false);
  });

  it('iniciar sem arquivo, corrompido ou com cifra de outro usuário fica deslogado', async () => {
    const { sessao, estado } = montar();
    expect(await sessao.iniciar()).toEqual({ situacao: 'deslogado' });

    await montar().sessao.entrar('teste@example.com', 'segredo');
    const salvo = JSON.parse(await readFile(arquivo, 'utf8'));
    await writeFile(arquivo, JSON.stringify({ ...salvo, renovacaoEnc: 'outra-maquina' }));
    expect(await sessao.iniciar()).toEqual({ situacao: 'deslogado' });
    expect(await existe(arquivo)).toBe(false);

    await writeFile(arquivo, '{ não é json');
    expect(await sessao.iniciar()).toEqual({ situacao: 'deslogado' });
    expect(estado.renovacoes).toEqual([]);
  });

  it('sair revoga na API e apaga o arquivo', async () => {
    const { sessao, estado } = montar();
    await sessao.entrar('teste@example.com', 'segredo');

    await sessao.sair();

    expect(estado.saidas).toEqual(['renovacao-1']);
    expect(sessao.estado()).toEqual({ situacao: 'deslogado' });
    expect(await existe(arquivo)).toBe(false);
    expect(await sessao.obterAcesso()).toBeUndefined();
  });

  it('sair apaga a sessão local mesmo sem rede', async () => {
    const { sessao, estado } = montar();
    await sessao.entrar('teste@example.com', 'segredo');
    estado.sairErro = new ErroIndisponivel('sem rede');

    await sessao.sair();

    expect(sessao.estado()).toEqual({ situacao: 'deslogado' });
    expect(await existe(arquivo)).toBe(false);
  });

  it('obterAcesso reaproveita o token até a margem e renova antes de expirar', async () => {
    const { sessao, estado } = montar();
    await sessao.entrar('teste@example.com', 'segredo');

    relogio.agora += 13 * 60_000;
    expect(await sessao.obterAcesso()).toBe('acesso-1');
    expect(estado.renovacoes).toEqual([]);

    // Faltam 30 s para expirar: dentro da margem de renovação.
    relogio.agora += 90_000 - 30_000;
    expect(await sessao.obterAcesso()).toBe('acesso-2');
    expect(estado.renovacoes).toEqual(['renovacao-1']);
    expect(JSON.parse(await readFile(arquivo, 'utf8')).renovacaoEnc).toBe('cifrado:renovacao-2');
  });

  it('chamadas simultâneas a obterAcesso renovam uma única vez', async () => {
    const { sessao, estado } = montar();
    await sessao.entrar('teste@example.com', 'segredo');
    relogio.agora += 20 * 60_000;

    const acessos = await Promise.all([sessao.obterAcesso(), sessao.obterAcesso(), sessao.obterAcesso()]);

    expect(acessos).toEqual(['acesso-2', 'acesso-2', 'acesso-2']);
    expect(estado.renovacoes).toEqual(['renovacao-1']);
  });

  it('401 ao renovar durante o uso derruba a sessão', async () => {
    const { sessao, estado } = montar();
    await sessao.entrar('teste@example.com', 'segredo');
    relogio.agora += 20 * 60_000;
    estado.renovarErro = new ErroRecusado(401, 'sessao_invalida', 'revogada');

    expect(await sessao.obterAcesso()).toBeUndefined();
    expect(sessao.estado()).toEqual({ situacao: 'deslogado' });
    expect(await existe(arquivo)).toBe(false);
  });
});
