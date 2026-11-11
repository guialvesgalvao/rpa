import { EsquemaErro, EsquemaNumerosOp, EsquemaRespostaEntrar } from '@plataforma/contratos';
import { eq } from 'drizzle-orm';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { empresas, opContadores } from '../../src/db/esquema.js';
import { criarUsuario } from '../../src/usuarios/servico.js';
import { criarAppTeste } from '../helpers/app.js';
import { criarBancoTeste, limparTabelas } from '../helpers/banco.js';

const { db, fechar } = criarBancoTeste();
afterAll(() => fechar());

const SENHA = 'senha-ficticia-123';

let app: FastifyInstance;
let admin: string;

async function entrar(
  email: string,
  perfil: 'admin' | 'arte_finalista',
  empresasDoUsuario: string[],
) {
  await criarUsuario(db, {
    email,
    nome: 'Usuária Teste',
    perfil,
    senha: SENHA,
    empresas: empresasDoUsuario,
  });
  const resposta = await app.inject({
    method: 'POST',
    url: '/v1/auth/entrar',
    payload: { email, senha: SENHA, origem: 'web' },
  });
  return EsquemaRespostaEntrar.parse(resposta.json()).acesso;
}

beforeEach(async () => {
  await limparTabelas(db);
  ({ app } = criarAppTeste(db));
  admin = await entrar('admin@exemplo.com', 'admin', ['aba', 'roma']);
});
afterEach(() => app.close());

const reservar = (empresa: string, payload: unknown, token: string | null = admin) =>
  app.inject({
    method: 'POST',
    url: `/v1/empresas/${empresa}/op/numeros`,
    payload: payload as object,
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });

const numerosDe = (resposta: LightMyRequestResponse) => {
  expect(resposta.statusCode).toBe(201);
  return EsquemaNumerosOp.parse(resposta.json()).numeros;
};

function esperarErro(resposta: LightMyRequestResponse, status: number, codigo: string) {
  expect(resposta.statusCode).toBe(status);
  expect(EsquemaErro.parse(resposta.json()).erro.codigo).toBe(codigo);
}

describe('POST /op/numeros', () => {
  it('reserva números consecutivos a partir de 1 e continua a sequência', async () => {
    expect(numerosDe(await reservar('roma', { quantidade: 3 }))).toEqual([1, 2, 3]);
    expect(numerosDe(await reservar('roma', { quantidade: 1 }))).toEqual([4]);
    expect(numerosDe(await reservar('roma', { quantidade: 2 }))).toEqual([5, 6]);
  });

  it('não repete número em reservas simultâneas', async () => {
    const respostas = await Promise.all(
      Array.from({ length: 12 }, () => reservar('roma', { quantidade: 5 })),
    );
    const todos = respostas.flatMap(numerosDe);
    expect(todos).toHaveLength(60);
    expect(new Set(todos).size).toBe(60);
    expect([...todos].sort((a, b) => a - b)).toEqual(Array.from({ length: 60 }, (_, i) => i + 1));
  });

  it('mantém um contador por empresa', async () => {
    expect(numerosDe(await reservar('roma', { quantidade: 2 }))).toEqual([1, 2]);
    expect(numerosDe(await reservar('aba', { quantidade: 2 }))).toEqual([1, 2]);
    expect(numerosDe(await reservar('roma', { quantidade: 1 }))).toEqual([3]);

    const [roma] = await db
      .select({ ultimo: opContadores.ultimo })
      .from(opContadores)
      .innerJoin(empresas, eq(empresas.id, opContadores.empresaId))
      .where(eq(empresas.slug, 'roma'));
    expect(roma?.ultimo).toBe(3);
  });

  it('rejeita quantidade ausente, zero, negativa, decimal, texto ou acima do limite', async () => {
    const invalidos = [
      {},
      { quantidade: 0 },
      { quantidade: -1 },
      { quantidade: 1.5 },
      { quantidade: '2' },
      { quantidade: 101 },
    ];
    for (const corpo of invalidos) {
      esperarErro(await reservar('roma', corpo), 400, 'requisicao_invalida');
    }
    // Pedido rejeitado não consome números.
    expect(numerosDe(await reservar('roma', { quantidade: 1 }))).toEqual([1]);
  });

  it('aceita o limite de 100 números de uma vez', async () => {
    expect(numerosDe(await reservar('roma', { quantidade: 100 }))).toHaveLength(100);
  });

  it('exige login, perfil admin e empresa do token', async () => {
    esperarErro(await reservar('roma', { quantidade: 1 }, null), 401, 'nao_autenticado');

    const finalista = await entrar('ana@exemplo.com', 'arte_finalista', ['roma']);
    esperarErro(await reservar('roma', { quantidade: 1 }, finalista), 403, 'permissao_proibida');

    const soAba = await entrar('bia@exemplo.com', 'admin', ['aba']);
    esperarErro(await reservar('roma', { quantidade: 1 }, soAba), 403, 'empresa_proibida');
  });
});
