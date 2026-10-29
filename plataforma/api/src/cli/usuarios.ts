import { createInterface } from 'node:readline';
import { Writable } from 'node:stream';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

import { type Banco, criarBanco } from '../db/cliente.js';
import { type Perfil, PERFIS } from '../db/esquema.js';
import {
  criarUsuario,
  definirEmpresas,
  desativar,
  ErroUsuario,
  listar,
  redefinirSenha,
} from '../usuarios/servico.js';

export const USO = `Uso: npm run usuarios -- <comando> [opções]

  criar     --email <e-mail> --nome <nome> --perfil <${PERFIS.join('|')}> --empresas <aba,roma>
  senha     --email <e-mail>
  empresas  --email <e-mail> --empresas <aba,roma>
  desativar --email <e-mail>
  listar

A senha é pedida no terminal, sem eco. Banco: DATABASE_PUBLIC_URL ou DATABASE_URL.`;

export type Comando =
  | { acao: 'criar'; email: string; nome: string; perfil: Perfil; empresas: string[] }
  | { acao: 'senha'; email: string }
  | { acao: 'empresas'; email: string; empresas: string[] }
  | { acao: 'desativar'; email: string }
  | { acao: 'listar' };

// Argumentos inválidos: mostra o uso.
export class ErroArgs extends Error {
  override name = 'ErroArgs';
}

// Falha de execução (cancelado, ambiente incompleto): só a mensagem.
export class ErroCli extends Error {
  override name = 'ErroCli';
}

const OPCOES = {
  criar: ['email', 'nome', 'perfil', 'empresas'],
  senha: ['email'],
  empresas: ['email', 'empresas'],
  desativar: ['email'],
  listar: [],
} as const satisfies Record<Comando['acao'], readonly string[]>;

type Acao = keyof typeof OPCOES;

const ehAcao = (texto: string | undefined): texto is Acao =>
  texto !== undefined && Object.hasOwn(OPCOES, texto);

const separarEmpresas = (lista: string) =>
  lista
    .split(',')
    .map((slug) => slug.trim())
    .filter(Boolean);

// Só interpreta e confere a presença das opções; o serviço valida o conteúdo.
export function interpretarArgs(argv: readonly string[]): Comando {
  const [acao, ...resto] = argv;
  if (!ehAcao(acao))
    throw new ErroArgs(acao ? `Comando desconhecido: ${acao}.` : 'Informe o comando.');

  let valores: Record<string, string | undefined>;
  try {
    const nomes: readonly string[] = OPCOES[acao];
    ({ values: valores } = parseArgs({
      args: [...resto],
      options: Object.fromEntries(nomes.map((nome) => [nome, { type: 'string' }] as const)),
      strict: true,
      allowPositionals: false,
    }) as { values: Record<string, string | undefined> });
  } catch (erro) {
    throw new ErroArgs(erro instanceof Error ? erro.message : String(erro));
  }

  const exigir = (nome: string): string => {
    const valor = valores[nome]?.trim();
    if (!valor) throw new ErroArgs(`Informe --${nome}.`);
    return valor;
  };

  switch (acao) {
    case 'criar': {
      const perfil = exigir('perfil');
      if (!PERFIS.includes(perfil as Perfil)) {
        throw new ErroArgs(`Perfil inválido: ${perfil} (use ${PERFIS.join(' ou ')}).`);
      }
      return {
        acao,
        email: exigir('email'),
        nome: exigir('nome'),
        perfil: perfil as Perfil,
        empresas: separarEmpresas(exigir('empresas')),
      };
    }
    case 'senha':
    case 'desativar':
      return { acao, email: exigir('email') };
    case 'empresas':
      return { acao, email: exigir('email'), empresas: separarEmpresas(exigir('empresas')) };
    case 'listar':
      return { acao };
  }
}

export type Terminal = {
  perguntar(pergunta: string): Promise<string>;
  perguntarSenha(pergunta: string): Promise<string>;
  escrever(texto: string): void;
};

async function lerSenhaNova(terminal: Terminal): Promise<string> {
  const senha = await terminal.perguntarSenha('Nova senha: ');
  const confirmacao = await terminal.perguntarSenha('Repita a senha: ');
  if (senha !== confirmacao) throw new ErroCli('As senhas não conferem.');
  return senha;
}

// Mostra o destino e, para comandos que gravam, pede confirmação. Devolve false se cancelado.
export async function executar(
  comando: Comando,
  { db, host, terminal }: { db: Banco; host: string; terminal: Terminal },
): Promise<boolean> {
  terminal.escrever(`Banco de destino: ${host}`);

  if (comando.acao === 'listar') {
    for (const u of await listar(db)) {
      const situacao = u.ativo ? 'ativo' : 'inativo';
      terminal.escrever(
        `${u.email}\t${u.nome}\t${u.perfil}\t${situacao}\t${u.empresas.join(',') || '-'}`,
      );
    }
    return true;
  }

  const resposta = await terminal.perguntar(`Gravar em ${host}? (s/N) `);
  if (resposta.trim().toLowerCase() !== 's') {
    terminal.escrever('Cancelado.');
    return false;
  }

  switch (comando.acao) {
    case 'criar': {
      const { email, nome, perfil, empresas } = comando;
      const senha = await lerSenhaNova(terminal);
      const criado = await criarUsuario(db, { email, nome, perfil, empresas, senha });
      terminal.escrever(`Usuário criado: ${criado.email} (${criado.perfil}).`);
      break;
    }
    case 'senha':
      await redefinirSenha(db, comando.email, await lerSenhaNova(terminal));
      terminal.escrever('Senha redefinida.');
      break;
    case 'empresas':
      await definirEmpresas(db, comando.email, comando.empresas);
      terminal.escrever('Empresas atualizadas.');
      break;
    case 'desativar':
      await desativar(db, comando.email);
      terminal.escrever('Usuário desativado e sessões revogadas.');
      break;
  }
  return true;
}

// Lê uma linha do terminal; com `oculto`, nada do que é digitado aparece na tela.
function perguntarNoTerminal(pergunta: string, oculto: boolean): Promise<string> {
  return new Promise((resolve, reject) => {
    let mudo = false;
    const saida = new Writable({
      write(pedaco, codificacao, feito) {
        if (!mudo) process.stdout.write(pedaco, codificacao);
        feito();
      },
    });
    const rl = createInterface({ input: process.stdin, output: saida, terminal: true });
    let respondida = false;
    rl.on('SIGINT', () => rl.close());
    rl.on('close', () => {
      if (!respondida) {
        process.stdout.write('\n');
        reject(new ErroCli('Operação cancelada.'));
      }
    });
    rl.question(pergunta, (resposta) => {
      respondida = true;
      if (oculto) process.stdout.write('\n');
      rl.close();
      resolve(resposta);
    });
    // A pergunta já foi escrita; daqui em diante o eco é suprimido.
    mudo = oculto;
  });
}

const terminalReal: Terminal = {
  perguntar: (pergunta) => perguntarNoTerminal(pergunta, false),
  perguntarSenha: (pergunta) => perguntarNoTerminal(pergunta, true),
  escrever: (texto) => console.log(texto),
};

function hostDe(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    throw new ErroCli('URL do banco inválida.');
  }
}

async function main(argv: string[]): Promise<number> {
  try {
    const comando = interpretarArgs(argv);
    if (!process.stdin.isTTY) throw new ErroCli('Rode em um terminal interativo.');
    const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
    if (!url) throw new ErroCli('Defina DATABASE_PUBLIC_URL ou DATABASE_URL.');
    const host = hostDe(url);

    const { db, fechar } = criarBanco(url);
    try {
      return (await executar(comando, { db, host, terminal: terminalReal })) ? 0 : 1;
    } finally {
      await fechar();
    }
  } catch (erro) {
    if (erro instanceof ErroArgs) {
      console.error(`${erro.message}\n\n${USO}`);
      return 1;
    }
    if (erro instanceof ErroCli || erro instanceof ErroUsuario) {
      console.error(erro.message);
      return 1;
    }
    throw erro;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.argv.slice(2));
}
