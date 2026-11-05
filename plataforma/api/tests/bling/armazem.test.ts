import { createHash } from 'node:crypto';

import { asc, eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { criarArmazemPostgres } from '../../src/bling/armazem.js';
import type {
  ClienteSincronizado,
  DadosSincronizacao,
  ProdutoSincronizado,
} from '../../src/bling/sincronizacao.js';
import { gerarCnpj, PDF_MINIMO } from '../../src/cli/semear-dev.js';
import { arquivos, artes, clientes, cores, empresas, produtos } from '../../src/db/esquema.js';
import { criarRelogioFalso } from '../helpers/app.js';
import { criarBancoTeste, limparTabelas } from '../helpers/banco.js';

// Só dados sintéticos.
const { db, fechar } = criarBancoTeste();
afterAll(() => fechar());

let relogio: ReturnType<typeof criarRelogioFalso>;
let aba: string;
let roma: string;
beforeEach(async () => {
  await limparTabelas(db);
  relogio = criarRelogioFalso();
  aba = await empresaId('aba');
  roma = await empresaId('roma');
});

async function empresaId(slug: string) {
  const [linha] = await db.select().from(empresas).where(eq(empresas.slug, slug));
  if (!linha) throw new Error(`empresa ${slug} não semeada`);
  return linha.id;
}

const salvar = (empresa: string, dados: Partial<DadosSincronizacao>) =>
  criarArmazemPostgres({ db, relogio: relogio.agora }).salvar(
    empresa,
    { produtos: [], clientes: [], avisos: [], ...dados },
    { modo: 'completa' },
  );

const cliente = (
  idBling: number,
  documento: string | null,
  nome = `Cliente ${idBling} Ltda`,
): ClienteSincronizado => ({
  idBling,
  nome,
  fantasia: null,
  tipoPessoa: 'J',
  documento,
});

const produto = (
  idBling: number,
  codigo: string | null,
  nome = `Produto ${idBling}`,
): ProdutoSincronizado => ({ idBling, codigo, nome, formato: 'S', idProdutoPai: null });

const linhasClientes = (empresa: string) =>
  db
    .select({
      id: clientes.id,
      idBling: clientes.idBling,
      cnpj: clientes.cnpj,
      razaoSocial: clientes.razaoSocial,
      nomeFantasia: clientes.nomeFantasia,
      inativoNoBlingEm: clientes.inativoNoBlingEm,
    })
    .from(clientes)
    .where(eq(clientes.empresaId, empresa))
    .orderBy(asc(clientes.cnpj));

const linhasProdutos = (empresa: string) =>
  db
    .select({
      id: produtos.id,
      idBling: produtos.idBling,
      codigo: produtos.codigo,
      nome: produtos.nome,
      inativoNoBlingEm: produtos.inativoNoBlingEm,
    })
    .from(produtos)
    .where(eq(produtos.empresaId, empresa))
    .orderBy(asc(produtos.nome));

async function criarArte(empresa: string, clienteId: string, produtoId: string) {
  const [cor] = await db.select().from(cores).limit(1);
  const [arquivo] = await db
    .insert(arquivos)
    .values({
      nomeOriginal: 'arte.pdf',
      tipoMime: 'application/pdf',
      tamanho: PDF_MINIMO.length,
      sha256: createHash('sha256').update(PDF_MINIMO).digest('hex'),
      conteudo: PDF_MINIMO,
    })
    .returning();
  const [arte] = await db
    .insert(artes)
    .values({ empresaId: empresa, clienteId, produtoId, corId: cor!.id, pdfId: arquivo!.id })
    .returning();
  return arte!;
}

const CNPJ_A = gerarCnpj(1);
const CNPJ_B = gerarCnpj(2);
const CNPJ_C = gerarCnpj(3);

describe('armazém Postgres', () => {
  it('insere clientes e produtos novos, com o id do Bling', async () => {
    const resultado = await salvar(roma, {
      clientes: [{ ...cliente(101, CNPJ_A), fantasia: 'Fantasia A' }, cliente(102, CNPJ_B)],
      produtos: [produto(201, 'SKU1'), produto(202, null)],
    });

    expect(resultado).toEqual({
      clientes: { inseridos: 2, atualizados: 0, inativados: 0, pulados: {} },
      produtos: { inseridos: 2, atualizados: 0, inativados: 0, pulados: {} },
      avisos: [],
    });
    expect(await linhasClientes(roma)).toMatchObject([
      { idBling: 101, cnpj: CNPJ_A, razaoSocial: 'Cliente 101 Ltda', nomeFantasia: 'Fantasia A' },
      { idBling: 102, cnpj: CNPJ_B, nomeFantasia: null, inativoNoBlingEm: null },
    ]);
    expect(await linhasProdutos(roma)).toMatchObject([
      { idBling: 201, codigo: 'SKU1', nome: 'Produto 201' },
      { idBling: 202, codigo: null, nome: 'Produto 202' },
    ]);
    expect(await db.$count(clientes, eq(clientes.empresaId, aba))).toBe(0);
  });

  it('atualiza pelo id do Bling (inclusive CNPJ e código) e não conta o que não mudou', async () => {
    await salvar(roma, { clientes: [cliente(101, CNPJ_A)], produtos: [produto(201, 'SKU1')] });
    const [antes] = await linhasClientes(roma);

    const resultado = await salvar(roma, {
      clientes: [{ ...cliente(101, CNPJ_B, 'Nome Novo Ltda'), fantasia: 'Novo' }],
      produtos: [produto(201, 'SKU9', 'Produto Renomeado')],
    });
    expect(resultado.clientes.atualizados).toBe(1);
    expect(resultado.produtos.atualizados).toBe(1);
    expect(await linhasClientes(roma)).toMatchObject([
      {
        id: antes!.id,
        idBling: 101,
        cnpj: CNPJ_B,
        razaoSocial: 'Nome Novo Ltda',
        nomeFantasia: 'Novo',
      },
    ]);
    expect(await linhasProdutos(roma)).toMatchObject([
      { idBling: 201, codigo: 'SKU9', nome: 'Produto Renomeado' },
    ]);

    const igual = await salvar(roma, {
      clientes: [{ ...cliente(101, CNPJ_B, 'Nome Novo Ltda'), fantasia: 'Novo' }],
      produtos: [produto(201, 'SKU9', 'Produto Renomeado')],
    });
    expect([igual.clientes, igual.produtos].map((c) => c.inseridos + c.atualizados)).toEqual([
      0, 0,
    ]);
  });

  it('adota o cadastro manual pelo CNPJ e pelo código, mantendo o id e as artes', async () => {
    const [manual] = await db
      .insert(clientes)
      .values({ empresaId: roma, razaoSocial: 'Manual Ltda', nomeFantasia: 'Manual', cnpj: CNPJ_A })
      .returning();
    const [produtoManual] = await db
      .insert(produtos)
      .values({ empresaId: roma, nome: 'Produto Manual', codigo: 'SKU1' })
      .returning();
    const arte = await criarArte(roma, manual!.id, produtoManual!.id);

    const resultado = await salvar(roma, {
      clientes: [cliente(101, CNPJ_A, 'Razão do Bling Ltda')],
      produtos: [produto(201, 'SKU1', 'Produto do Bling')],
    });

    expect(resultado.clientes).toMatchObject({ inseridos: 0, atualizados: 1 });
    expect(resultado.produtos).toMatchObject({ inseridos: 0, atualizados: 1 });
    expect(await linhasClientes(roma)).toMatchObject([
      // O Bling é a fonte da verdade: a fantasia manual sai.
      { id: manual!.id, idBling: 101, razaoSocial: 'Razão do Bling Ltda', nomeFantasia: null },
    ]);
    expect(await linhasProdutos(roma)).toMatchObject([
      { id: produtoManual!.id, idBling: 201, codigo: 'SKU1', nome: 'Produto do Bling' },
    ]);
    const [arteDepois] = await db.select().from(artes).where(eq(artes.id, arte.id));
    expect(arteDepois).toMatchObject({ clienteId: manual!.id, produtoId: produtoManual!.id });
  });

  it('deixa de fora CNPJ inválido, CPF, sem documento e sem nome, com avisos agregados', async () => {
    const resultado = await salvar(roma, {
      clientes: [
        cliente(101, CNPJ_A),
        cliente(102, '11222333000100'),
        { ...cliente(103, '12345678909'), tipoPessoa: 'F' },
        cliente(104, null),
        cliente(105, '1234'),
        cliente(106, CNPJ_B, '   '),
      ],
      produtos: [produto(201, 'SKU1', '  ')],
    });

    expect(resultado.clientes).toEqual({
      inseridos: 1,
      atualizados: 0,
      inativados: 0,
      pulados: { cnpj_invalido: 4, sem_nome: 1 },
    });
    expect(resultado.avisos).toEqual([
      '4 clientes sem CNPJ válido ficaram de fora.',
      '1 cliente sem nome ficou de fora.',
      '1 produto sem nome ficou de fora.',
    ]);
    expect((await linhasClientes(roma)).map((c) => c.idBling)).toEqual([101]);
  });

  it('CNPJ repetido no Bling: fica o primeiro lido, ou o vínculo existente', async () => {
    const primeira = await salvar(roma, {
      clientes: [cliente(101, CNPJ_A), cliente(102, CNPJ_A)],
    });
    expect(primeira.clientes).toMatchObject({ inseridos: 1, pulados: { cnpj_repetido: 1 } });
    expect(primeira.avisos).toEqual(['1 cliente com CNPJ repetido ficou de fora.']);

    // O vínculo existente (101) vence, mesmo lido depois.
    const segunda = await salvar(roma, {
      clientes: [cliente(102, CNPJ_A, 'Outro Ltda'), cliente(101, CNPJ_A, 'Atualizado Ltda')],
    });
    expect(segunda.clientes).toMatchObject({ atualizados: 1, pulados: { cnpj_repetido: 1 } });
    expect(await linhasClientes(roma)).toMatchObject([
      { idBling: 101, razaoSocial: 'Atualizado Ltda' },
    ]);
  });

  it('cliente já ligado que muda para o CNPJ de outra linha fica como estava', async () => {
    await salvar(roma, { clientes: [cliente(101, CNPJ_A), cliente(102, CNPJ_B)] });
    const resultado = await salvar(roma, {
      clientes: [cliente(101, CNPJ_B, 'Mudou Ltda'), cliente(102, CNPJ_B)],
    });
    expect(resultado.clientes.pulados).toEqual({ cnpj_repetido: 1 });
    expect(await linhasClientes(roma)).toMatchObject([
      { idBling: 101, cnpj: CNPJ_A, razaoSocial: 'Cliente 101 Ltda' },
      { idBling: 102, cnpj: CNPJ_B },
    ]);
  });

  it('código repetido e produto ligado que muda para um código em uso geram aviso sem quebrar', async () => {
    await salvar(roma, { produtos: [produto(201, 'SKU1'), produto(202, 'SKU2')] });

    const resultado = await salvar(roma, {
      produtos: [
        produto(201, 'SKU2', 'Renomeado'),
        produto(202, 'SKU2'),
        produto(203, 'SKU2'),
        produto(204, 'SKU4'),
      ],
    });

    expect(resultado.produtos).toEqual({
      inseridos: 1,
      atualizados: 0,
      inativados: 0,
      pulados: { codigo_repetido: 2 },
    });
    expect(resultado.avisos).toEqual(['2 produtos com código repetido ficaram de fora.']);
    expect(await linhasProdutos(roma)).toMatchObject([
      { idBling: 201, codigo: 'SKU1', nome: 'Produto 201' },
      { idBling: 202, codigo: 'SKU2' },
      { idBling: 204, codigo: 'SKU4' },
    ]);
  });

  it('nome de produto repetido (sem acento nem caixa) fica de fora pela restrição do banco', async () => {
    const resultado = await salvar(roma, {
      produtos: [produto(201, 'SKU1', 'Caixa Pão'), produto(202, 'SKU2', 'caixa pao')],
    });
    expect(resultado.produtos).toMatchObject({ inseridos: 1, pulados: { nome_repetido: 1 } });
    expect(resultado.avisos).toEqual(['1 produto com nome repetido ficou de fora.']);
  });

  it('na completa, marca quem sumiu do Bling e limpa a marca quando reaparece', async () => {
    await db
      .insert(clientes)
      .values({ empresaId: roma, razaoSocial: 'Manual Sem Vínculo Ltda', cnpj: CNPJ_C });
    await salvar(roma, {
      clientes: [cliente(101, CNPJ_A), cliente(102, CNPJ_B)],
      produtos: [produto(201, 'SKU1'), produto(202, 'SKU2')],
    });
    await salvar(aba, { clientes: [cliente(101, CNPJ_A)] });

    relogio.avancar(60_000);
    const marca = relogio.agora();
    const sumiu = await salvar(roma, {
      clientes: [cliente(101, CNPJ_A)],
      produtos: [produto(201, 'SKU1')],
    });
    expect(sumiu.clientes.inativados).toBe(1);
    expect(sumiu.produtos.inativados).toBe(1);
    expect(
      (await linhasClientes(roma)).map((c) => [c.idBling, c.inativoNoBlingEm?.toISOString()]),
    ).toEqual([
      [101, undefined],
      [102, marca.toISOString()],
      // Cadastro manual sem vínculo nunca é marcado.
      [null, undefined],
    ]);
    // Outra empresa não é afetada.
    expect((await linhasClientes(aba))[0]?.inativoNoBlingEm).toBeNull();

    // Uma segunda completa não remarca (a data fica a da primeira ausência).
    relogio.avancar(60_000);
    expect(
      (await salvar(roma, { clientes: [cliente(101, CNPJ_A)], produtos: [produto(201, 'SKU1')] }))
        .clientes.inativados,
    ).toBe(0);

    const voltou = await salvar(roma, {
      clientes: [cliente(101, CNPJ_A), cliente(102, CNPJ_B)],
      produtos: [produto(201, 'SKU1'), produto(202, 'SKU2')],
    });
    expect(voltou.clientes).toMatchObject({ atualizados: 1, inativados: 0 });
    expect(voltou.produtos).toMatchObject({ atualizados: 1, inativados: 0 });
    expect((await linhasClientes(roma)).every((c) => c.inativoNoBlingEm === null)).toBe(true);
    expect((await linhasProdutos(roma)).every((p) => p.inativoNoBlingEm === null)).toBe(true);
  });

  it('uma falha no meio desfaz tudo', async () => {
    await salvar(roma, { clientes: [cliente(101, CNPJ_A)] });

    // O byte nulo é recusado pelo Postgres (erro fora dos tratados por linha).
    await expect(
      salvar(roma, {
        clientes: [cliente(101, CNPJ_A, 'Mudou Ltda'), cliente(102, CNPJ_B)],
        produtos: [produto(201, 'SKU1'), produto(202, 'SKU2', 'Nome\u0000Quebrado')],
      }),
    ).rejects.toThrow();

    expect(await linhasClientes(roma)).toMatchObject([
      { idBling: 101, razaoSocial: 'Cliente 101 Ltda' },
    ]);
    expect(await db.$count(produtos)).toBe(0);
  });
});
