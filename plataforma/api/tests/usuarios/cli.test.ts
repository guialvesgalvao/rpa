import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { conferirSenha } from '../../src/auth/senha.js';
import {
  type Comando,
  ErroArgs,
  ErroCli,
  executar,
  interpretarArgs,
  type Terminal,
} from '../../src/cli/usuarios.js';
import { listar } from '../../src/usuarios/servico.js';
import { criarBancoTeste, limparTabelas } from '../helpers/banco.js';

describe('interpretarArgs', () => {
  it('interpreta cada comando', () => {
    expect(
      interpretarArgs([
        'criar',
        '--email',
        'ana@exemplo.com',
        '--nome',
        'Ana Teste',
        '--perfil',
        'admin',
        '--empresas',
        'aba, roma,',
      ]),
    ).toEqual({
      acao: 'criar',
      email: 'ana@exemplo.com',
      nome: 'Ana Teste',
      perfil: 'admin',
      empresas: ['aba', 'roma'],
    });
    expect(interpretarArgs(['senha', '--email=ana@exemplo.com'])).toEqual({
      acao: 'senha',
      email: 'ana@exemplo.com',
    });
    expect(
      interpretarArgs(['empresas', '--email', 'ana@exemplo.com', '--empresas', 'roma']),
    ).toEqual({ acao: 'empresas', email: 'ana@exemplo.com', empresas: ['roma'] });
    expect(interpretarArgs(['desativar', '--email', 'ana@exemplo.com'])).toEqual({
      acao: 'desativar',
      email: 'ana@exemplo.com',
    });
    expect(interpretarArgs(['listar'])).toEqual({ acao: 'listar' });
  });

  it.each([
    ['sem comando', [], 'Informe o comando.'],
    ['comando desconhecido', ['apagar'], 'Comando desconhecido: apagar.'],
    ['comando herdado de Object', ['toString'], 'Comando desconhecido: toString.'],
    ['opção obrigatória ausente', ['senha'], 'Informe --email.'],
    ['opção vazia', ['senha', '--email', ' '], 'Informe --email.'],
    [
      'perfil inválido',
      ['criar', '--email', 'a@b.c', '--nome', 'A', '--perfil', 'gerente', '--empresas', 'aba'],
      'Perfil inválido: gerente (use admin ou arte_finalista).',
    ],
  ])('recusa %s', (_caso, argv, mensagem) => {
    expect(() => interpretarArgs(argv)).toThrow(new ErroArgs(mensagem));
  });

  it.each([
    ['opção de outro comando', ['listar', '--email', 'a@b.c']],
    ['opção desconhecida', ['senha', '--email', 'a@b.c', '--senha', 'x']],
    ['argumento solto', ['desativar', 'a@b.c']],
    ['senha na linha de comando', ['criar', '--email', 'a@b.c', '--senha', 'x']],
  ])('recusa %s', (_caso, argv) => {
    expect(() => interpretarArgs(argv)).toThrow(ErroArgs);
  });
});

describe('executar', () => {
  const { db, fechar } = criarBancoTeste();
  afterAll(() => fechar());
  beforeEach(() => limparTabelas(db));

  // Terminal falso: devolve as respostas na ordem e guarda o que foi escrito.
  function terminalFalso(respostas: string[]) {
    const saida: string[] = [];
    const senhasPedidas: string[] = [];
    const proxima = async () => {
      const resposta = respostas.shift();
      if (resposta === undefined) throw new Error('pergunta inesperada');
      return resposta;
    };
    const terminal: Terminal = {
      perguntar: proxima,
      perguntarSenha: async (pergunta) => {
        senhasPedidas.push(pergunta);
        return proxima();
      },
      escrever: (texto) => saida.push(texto),
    };
    return { terminal, saida, senhasPedidas };
  }

  const rodar = (comando: Comando, respostas: string[]) => {
    const falso = terminalFalso(respostas);
    const resultado = executar(comando, { db, host: 'localhost:5433', terminal: falso.terminal });
    return { resultado, ...falso };
  };

  const criar: Comando = {
    acao: 'criar',
    email: 'ana@exemplo.com',
    nome: 'Ana Teste',
    perfil: 'admin',
    empresas: ['aba', 'roma'],
  };

  it('cria, lista, redefine a senha e desativa', async () => {
    const criacao = rodar(criar, ['s', 'senha-ficticia-123', 'senha-ficticia-123']);
    expect(await criacao.resultado).toBe(true);
    expect(criacao.saida).toEqual([
      'Banco de destino: localhost:5433',
      'Usuário criado: ana@exemplo.com (admin).',
    ]);
    expect(criacao.senhasPedidas).toEqual(['Nova senha: ', 'Repita a senha: ']);

    const listagem = rodar({ acao: 'listar' }, []);
    expect(await listagem.resultado).toBe(true);
    expect(listagem.saida).toEqual([
      'Banco de destino: localhost:5433',
      'ana@exemplo.com\tAna Teste\tadmin\tativo\taba,roma',
    ]);

    const troca = rodar({ acao: 'senha', email: 'ana@exemplo.com' }, [
      'S',
      'outra-senha-ficticia',
      'outra-senha-ficticia',
    ]);
    expect(await troca.resultado).toBe(true);
    expect(troca.saida).toContain('Senha redefinida.');

    const empresas = rodar({ acao: 'empresas', email: 'ana@exemplo.com', empresas: ['roma'] }, [
      's',
    ]);
    expect(await empresas.resultado).toBe(true);

    const desativacao = rodar({ acao: 'desativar', email: 'ana@exemplo.com' }, ['s']);
    expect(await desativacao.resultado).toBe(true);
    expect(desativacao.saida).toContain('Usuário desativado e sessões revogadas.');

    const [ana] = await listar(db);
    expect(ana).toMatchObject({ ativo: false, empresas: ['roma'] });
  });

  it('não grava nem pede senha sem a confirmação "s"', async () => {
    for (const resposta of ['', 'n', 'sim']) {
      const execucao = rodar(criar, [resposta]);
      expect(await execucao.resultado).toBe(false);
      expect(execucao.saida).toContain('Cancelado.');
      expect(execucao.senhasPedidas).toEqual([]);
    }
    expect(await listar(db)).toEqual([]);
  });

  it('recusa senhas que não conferem', async () => {
    const execucao = rodar(criar, ['s', 'senha-ficticia-123', 'senha-ficticia-124']);
    await expect(execucao.resultado).rejects.toThrow(new ErroCli('As senhas não conferem.'));
    expect(await listar(db)).toEqual([]);
  });

  it('grava a senha digitada', async () => {
    await rodar(criar, ['s', 'senha-ficticia-123', 'senha-ficticia-123']).resultado;
    const [linha] = await db.query.usuarios.findMany({ columns: { senhaHash: true } });
    expect(await conferirSenha('senha-ficticia-123', linha?.senhaHash ?? '')).toBe(true);
  });
});
