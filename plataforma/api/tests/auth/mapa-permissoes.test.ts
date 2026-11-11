import {
  EsquemaErro,
  EsquemaRespostaEntrar,
  type Permissao,
  PERMISSOES,
} from '@plataforma/contratos';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { criarUsuario } from '../../src/usuarios/servico.js';
import { criarAppTeste } from '../helpers/app.js';
import { criarBancoTeste, limparTabelas } from '../helpers/banco.js';

// Qual permissão cada rota exige (ADR 0011). Para cada linha: quem tem todas as outras permissões recebe 403
// `permissao_proibida`; quem tem só a exigida (com o módulo dela) passa da autorização. Os ids são fictícios,
// então "passar" pode ser 404 ou 400: o que importa é não ser a recusa por permissão.
const ID = '7b0e6c0a-3f5e-4c59-9d0a-2f3c1a4b5d6e';
const E = '/v1/empresas/roma';

type Metodo = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
const MAPA: [Metodo, string, Permissao][] = [
  ['GET', `${E}/clientes`, 'artes'],
  ['GET', `${E}/clientes/${ID}`, 'artes'],
  ['GET', `${E}/clientes/${ID}/produtos`, 'artes'],
  ['GET', `${E}/clientes/${ID}/produtos/${ID}/artes`, 'artes'],
  ['GET', `${E}/produtos`, 'artes'],
  ['GET', `${E}/artes/${ID}/imagem`, 'artes'],
  ['GET', `${E}/artes/${ID}/pdf`, 'artes'],
  ['POST', `${E}/clientes/${ID}/artes`, 'artes.adicionar'],
  ['PATCH', `${E}/artes/${ID}`, 'artes.editar'],
  ['DELETE', `${E}/artes/${ID}`, 'artes.editar'],
  ['POST', '/v1/cores', 'artes.adicionar'],
  ['GET', `${E}/tarefas`, 'artes'],
  ['GET', `${E}/tarefas/contagem`, 'artes'],
  ['GET', `${E}/tarefas/${ID}`, 'artes'],
  ['GET', `${E}/tarefas/${ID}/historico`, 'artes'],
  ['GET', `${E}/tarefas/${ID}/comentarios/${ID}/anexos/${ID}`, 'artes'],
  ['PATCH', `${E}/tarefas/${ID}/status`, 'artes'],
  ['POST', `${E}/tarefas/${ID}/comentarios`, 'artes'],
  ['POST', `${E}/clientes/${ID}/produtos/${ID}/tarefas`, 'artes.adicionar'],
  ['POST', `${E}/tarefas/${ID}/concluir`, 'artes.adicionar'],
  ['GET', `${E}/tarefas/responsavel-automatico`, 'artes.acompanhar'],
  ['PUT', `${E}/tarefas/responsavel-automatico`, 'artes.acompanhar'],
  ['POST', `${E}/op/numeros`, 'ops'],
  ['POST', `${E}/bling/conexao`, 'ops'],
  ['POST', `${E}/bling/sincronizacao`, 'ops'],
  ['GET', `${E}/bling/sincronizacao`, 'ops'],
  ['GET', `${E}/bling/sincronizacao/automatica`, 'ops'],
  ['GET', `${E}/compras/insumos`, 'compras.pedir'],
  ['POST', `${E}/compras/pedidos`, 'compras.pedir'],
  ['GET', `${E}/compras/pedidos`, 'compras'],
  ['GET', `${E}/compras/pedidos/${ID}`, 'compras'],
  ['GET', `${E}/compras/pedidos/${ID}/historico`, 'compras'],
  ['PATCH', `${E}/compras/pedidos/${ID}`, 'compras'],
  ['PATCH', `${E}/compras/pedidos/${ID}/status`, 'compras'],
  ['POST', `${E}/compras/pedidos/${ID}/assumir`, 'compras.acompanhar'],
];

const { db, fechar } = criarBancoTeste();
const SENHA = 'senha-ficticia-123';
let app: FastifyInstance;
const tokens = new Map<string, string>();

const moduloDe = (chave: Permissao) => chave.split('.')[0] as Permissao;
const somente = (chave: Permissao): Permissao[] => [...new Set([moduloDe(chave), chave])];
// Tirar o módulo tira junto as subpermissões dele.
const todasMenos = (chave: Permissao): Permissao[] =>
  PERMISSOES.filter((outra) => outra !== chave && !outra.startsWith(`${chave}.`));

async function tokenCom(nome: string, permissoes: Permissao[]): Promise<string> {
  const salvo = tokens.get(nome);
  if (salvo) return salvo;
  const email = `${nome.replaceAll('.', '-')}@exemplo.com`;
  await criarUsuario(db, {
    email,
    nome,
    senha: SENHA,
    empresas: ['roma'],
    permissoes: { roma: permissoes },
  });
  const resposta = await app.inject({
    method: 'POST',
    url: '/v1/auth/entrar',
    payload: { email, senha: SENHA, origem: 'web' },
  });
  const { acesso } = EsquemaRespostaEntrar.parse(resposta.json());
  tokens.set(nome, acesso);
  return acesso;
}

beforeAll(async () => {
  await limparTabelas(db);
  ({ app } = criarAppTeste(db));
});
afterAll(async () => {
  await app.close();
  await fechar();
});

describe('mapa de permissões das rotas', () => {
  it.each(MAPA)('%s %s exige %s', async (method, url, chave) => {
    const pedir = (acesso: string) =>
      app.inject({ method, url, headers: { authorization: `Bearer ${acesso}` } });

    const sem = await pedir(await tokenCom(`sem-${chave}`, todasMenos(chave)));
    expect(sem.statusCode).toBe(403);
    expect(EsquemaErro.parse(sem.json()).erro.codigo).toBe('permissao_proibida');

    const com = await pedir(await tokenCom(`so-${chave}`, somente(chave)));
    expect(com.statusCode).not.toBe(401);
    if (com.statusCode === 403) {
      expect(EsquemaErro.parse(com.json()).erro.codigo).not.toBe('permissao_proibida');
    }
  });
});
