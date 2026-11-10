import { pathToFileURL } from 'node:url';

import postgres from 'postgres';

import { criarBanco } from '../db/cliente.js';
import { migrar } from '../db/migrar.js';
import { criarUsuario, desativar } from '../usuarios/servico.js';
import { exigirBancoLocal, semear, SENHA_DEV } from './semear-dev.js';

// Banco da suíte E2E local (`npm run e2e` na raiz): recriado do zero a cada execução, com dados fictícios.
// Nunca roda fora de localhost, nem num banco cujo nome não termine em `_e2e` (protege `rpa` e `rpa_teste`).

const SUFIXO = '_e2e';

/** Usuários extras da suíte, além de admin.dev e finalista.dev do `semear`. Dados fictícios. */
export const USUARIOS_E2E = [
  {
    email: 'desativavel.e2e@exemplo.com',
    nome: 'Usuária Desativável',
    perfil: 'arte_finalista' as const,
    empresas: ['aba', 'roma'],
  },
  {
    email: 'troca.e2e@exemplo.com',
    nome: 'Usuário Troca Senha',
    perfil: 'arte_finalista' as const,
    empresas: ['aba'],
    deveTrocarSenha: true,
  },
];

export function exigirBancoE2e(url: string): string {
  exigirBancoLocal(url);
  const nome = decodeURIComponent(new URL(url).pathname.replace(/^\//, ''));
  if (!nome.endsWith(SUFIXO) || !/^[a-z0-9_]+$/.test(nome)) {
    throw new Error(`O banco da E2E precisa terminar em ${SUFIXO} (recebido: ${nome || 'vazio'}).`);
  }
  return nome;
}

async function criarSeFaltar(url: string, nome: string): Promise<void> {
  const administrativa = new URL(url);
  administrativa.pathname = '/postgres';
  const conexao = postgres(administrativa.toString(), { max: 1, onnotice: () => {} });
  try {
    const existe = await conexao`SELECT 1 FROM pg_database WHERE datname = ${nome}`;
    // O nome já passou pela regex de `exigirBancoE2e`.
    if (existe.length === 0) await conexao.unsafe(`CREATE DATABASE ${nome}`);
  } finally {
    await conexao.end();
  }
}

async function zerar(url: string): Promise<void> {
  const conexao = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await conexao`DROP SCHEMA IF EXISTS drizzle CASCADE`;
    await conexao`DROP SCHEMA IF EXISTS public CASCADE`;
    await conexao`CREATE SCHEMA public`;
  } finally {
    await conexao.end();
  }
}

/** Cria o banco se faltar, apaga tudo, migra e semeia (dev + usuários da E2E). */
export async function prepararE2e(url: string): Promise<void> {
  const nome = exigirBancoE2e(url);
  await criarSeFaltar(url, nome);
  await zerar(url);
  await migrar(url);
  const { db, fechar } = criarBanco(url);
  try {
    await semear(db);
    for (const usuario of USUARIOS_E2E) await criarUsuario(db, { ...usuario, senha: SENHA_DEV });
  } finally {
    await fechar();
  }
}

/** Desativa um usuário no banco da E2E (o cenário "usuário desativado" do app). */
export async function desativarE2e(url: string, email: string): Promise<void> {
  exigirBancoE2e(url);
  const { db, fechar } = criarBanco(url);
  try {
    await desativar(db, email);
  } finally {
    await fechar();
  }
}

// `npm run e2e:banco -- preparar` ou `-- desativar <email>`; lê só `DATABASE_URL`.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const url = process.env.DATABASE_URL;
  const [comando = 'preparar', email] = process.argv.slice(2);
  try {
    if (!url) throw new Error('Defina DATABASE_URL (banco local terminado em _e2e).');
    if (comando === 'preparar') {
      await prepararE2e(url);
      console.log('Banco da E2E pronto.');
    } else if (comando === 'desativar' && email) {
      await desativarE2e(url, email);
      console.log(`Usuário ${email} desativado.`);
    } else {
      throw new Error('Uso: preparar | desativar <email>');
    }
  } catch (erro) {
    console.error(erro instanceof Error ? erro.message : erro);
    process.exit(1);
  }
}
