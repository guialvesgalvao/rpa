import { createHash } from 'node:crypto';

import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import {
  arteMaquinas,
  arquivos,
  artes,
  clientes,
  cores,
  empresas,
  maquinas,
  produtos,
  usuarios,
} from '../../src/db/esquema.js';
import {
  CLIENTES_POR_EMPRESA,
  exigirBancoLocal,
  gerarCnpj,
  PDF_MINIMO,
  semear,
} from '../../src/cli/semear-dev.js';
import { codigoDoErro, criarBancoTeste, limparTabelas } from '../helpers/banco.js';

const VIOLA_CHECK = '23514';
const VIOLA_UNICO = '23505';
const VIOLA_FK = '23503';
const VALOR_LONGO = '22001';

const { db, fechar } = criarBancoTeste();
afterAll(() => fechar());
beforeEach(() => limparTabelas(db));

async function empresa(slug: string) {
  const [linha] = await db.select().from(empresas).where(eq(empresas.slug, slug));
  if (!linha) throw new Error(`empresa ${slug} não semeada`);
  return linha;
}

const novoCliente = async (slug: string, dados: Partial<typeof clientes.$inferInsert> = {}) =>
  db
    .insert(clientes)
    .values({
      empresaId: (await empresa(slug)).id,
      razaoSocial: 'Padaria Exemplo Ltda',
      cnpj: gerarCnpj(1),
      ...dados,
    })
    .returning();

async function criarCliente(slug = 'aba', dados: Partial<typeof clientes.$inferInsert> = {}) {
  const [cliente] = await novoCliente(slug, dados);
  if (!cliente) throw new Error('cliente não criado');
  return cliente;
}

async function criarProduto(slug = 'aba', nome = 'Caixa de Pizza') {
  const [produto] = await db
    .insert(produtos)
    .values({ empresaId: (await empresa(slug)).id, nome })
    .returning();
  if (!produto) throw new Error('produto não criado');
  return produto;
}

async function criarArquivo() {
  const conteudo = PDF_MINIMO;
  const [arquivo] = await db
    .insert(arquivos)
    .values({
      nomeOriginal: 'arte.pdf',
      tipoMime: 'application/pdf',
      tamanho: conteudo.length,
      sha256: createHash('sha256').update(conteudo).digest('hex'),
      conteudo,
    })
    .returning();
  if (!arquivo) throw new Error('arquivo não criado');
  return arquivo;
}

async function corPadrao() {
  const [cor] = await db.select().from(cores).where(eq(cores.nome, '4x0'));
  if (!cor) throw new Error('cor 4x0 não semeada');
  return cor;
}

// Arte válida (com PDF) para o cliente e o produto; `dados` sobrescreve qualquer campo.
async function novaArte(
  cliente: { id: string; empresaId: string },
  produto: { id: string },
  dados: Partial<typeof artes.$inferInsert> = {},
) {
  const arquivo = await criarArquivo();
  return db
    .insert(artes)
    .values({
      empresaId: cliente.empresaId,
      clienteId: cliente.id,
      produtoId: produto.id,
      corId: (await corPadrao()).id,
      pdfId: arquivo.id,
      ...dados,
    })
    .returning();
}

describe('migrações de Artes', () => {
  it('semeiam as cores e as máquinas', async () => {
    const nomesCores = (await db.select({ nome: cores.nome }).from(cores)).map((c) => c.nome);
    const nomesMaquinas = (await db.select({ nome: maquinas.nome }).from(maquinas)).map(
      (m) => m.nome,
    );
    expect(nomesCores.sort()).toEqual(['4x0', '4x4']);
    expect(nomesMaquinas.sort()).toEqual(['Favorit', 'Rekord']);
  });

  it('f_unaccent remove acentos e é imutável', async () => {
    const [linha] = await db.execute<{ texto: string; volatilidade: string }>(
      sql`SELECT f_unaccent('Açaí São João') AS texto,
                 (SELECT provolatile FROM pg_proc WHERE proname = 'f_unaccent') AS volatilidade`,
    );
    expect(linha).toEqual({ texto: 'Acai Sao Joao', volatilidade: 'i' });
  });
});

describe('cnpj_valido', () => {
  it.each([
    ['gerado pelo algoritmo', gerarCnpj(1), true],
    ['outro gerado', gerarCnpj(987_654), true],
    [
      'dígito verificador errado',
      `${gerarCnpj(1).slice(0, 13)}${(Number(gerarCnpj(1).at(13)) + 1) % 10}`,
      false,
    ],
    ['com máscara', '11.222.333/0001-81', false],
    ['curto', '1122233300018', false],
    ['dígitos repetidos', '11111111111111', false],
    ['letras', 'ABCDEFGHIJKLMN', false],
  ])('%s', async (_nome, cnpj, esperado) => {
    const [linha] = await db.execute<{ valido: boolean }>(
      sql`SELECT cnpj_valido(${cnpj}) AS valido`,
    );
    expect(linha?.valido).toBe(esperado);
  });
});

describe('clientes', () => {
  it('aceita um cliente válido e gera nome de exibição e busca sem acento', async () => {
    const cliente = await criarCliente('aba', {
      razaoSocial: 'Pão Quente Comércio Ltda',
      nomeFantasia: 'Padaria Açaí',
    });
    expect(cliente.nomeExibicao).toBe('Padaria Açaí');
    expect(cliente.busca).toBe(`pao quente comercio ltda padaria acai ${cliente.cnpj}`);
  });

  it('usa a razão social como nome de exibição quando não há fantasia', async () => {
    const cliente = await criarCliente('aba', { razaoSocial: 'Doceria Ouro Ltda' });
    expect(cliente.nomeFantasia).toBeNull();
    expect(cliente.nomeExibicao).toBe('Doceria Ouro Ltda');
  });

  it('rejeita CNPJ inválido ou com dígitos repetidos', async () => {
    for (const cnpj of ['12345678000199', '00000000000000', 'ABCDEFGHIJKLMN']) {
      expect(await codigoDoErro(novoCliente('aba', { cnpj })), cnpj).toBe(VIOLA_CHECK);
    }
  });

  it('rejeita CNPJ formatado: com máscara não cabe nos 14 caracteres', async () => {
    expect(await codigoDoErro(novoCliente('aba', { cnpj: '11.222.333/0001-81' }))).toBe(
      VALOR_LONGO,
    );
  });

  it('rejeita razão social e fantasia em branco', async () => {
    expect(await codigoDoErro(novoCliente('aba', { razaoSocial: '  ' }))).toBe(VIOLA_CHECK);
    expect(await codigoDoErro(novoCliente('aba', { nomeFantasia: ' ' }))).toBe(VIOLA_CHECK);
  });

  it('rejeita CNPJ repetido na empresa, mas aceita o mesmo em outra', async () => {
    await criarCliente('aba');
    expect(await codigoDoErro(novoCliente('aba'))).toBe(VIOLA_UNICO);
    expect(await codigoDoErro(novoCliente('roma'))).toBeUndefined();
  });
});

describe('produtos', () => {
  it('rejeita nome repetido na empresa sem diferenciar maiúsculas nem acentos', async () => {
    await criarProduto('aba', 'Caixa Café');
    const aba = await empresa('aba');
    const repetido = (nome: string) => db.insert(produtos).values({ empresaId: aba.id, nome });
    expect(await codigoDoErro(repetido('caixa cafe'))).toBe(VIOLA_UNICO);
    expect(await codigoDoErro(repetido('CAIXA CAFÉ'))).toBe(VIOLA_UNICO);
  });

  it('aceita o mesmo nome em outra empresa', async () => {
    await criarProduto('aba', 'Sacola');
    expect(await codigoDoErro(criarProduto('roma', 'Sacola'))).toBeUndefined();
  });
});

describe('artes', () => {
  it('aceita só PDF, só imagem e os dois, com nome padrão', async () => {
    const cliente = await criarCliente();
    const produto = await criarProduto();
    const imagem = await criarArquivo();
    const [soPdf] = await novaArte(cliente, produto);
    const [soImagem] = await novaArte(cliente, produto, {
      nome: 'Só imagem',
      pdfId: null,
      imagemId: imagem.id,
    });
    const outroArquivo = await criarArquivo();
    const [ambos] = await novaArte(cliente, produto, {
      nome: 'Ambos',
      imagemId: outroArquivo.id,
    });
    expect(soPdf?.nome).toBe('Padrão');
    expect(soImagem?.pdfId).toBeNull();
    expect(ambos?.imagemId).toBe(outroArquivo.id);
  });

  it('rejeita arte sem nenhum arquivo', async () => {
    const cliente = await criarCliente();
    const produto = await criarProduto();
    expect(await codigoDoErro(novaArte(cliente, produto, { pdfId: null }))).toBe(VIOLA_CHECK);
  });

  it('rejeita nome repetido para o mesmo cliente e produto, sem diferenciar maiúsculas nem acentos', async () => {
    const cliente = await criarCliente();
    const produto = await criarProduto();
    await novaArte(cliente, produto);
    expect(await codigoDoErro(novaArte(cliente, produto))).toBe(VIOLA_UNICO);
    expect(await codigoDoErro(novaArte(cliente, produto, { nome: 'padrao' }))).toBe(VIOLA_UNICO);
    expect(await codigoDoErro(novaArte(cliente, produto, { nome: 'PADRÃO' }))).toBe(VIOLA_UNICO);
  });

  it('aceita o mesmo nome em outro produto ou outro cliente', async () => {
    const cliente = await criarCliente();
    const outroCliente = await criarCliente('aba', { cnpj: gerarCnpj(2) });
    const produto = await criarProduto();
    const outroProduto = await criarProduto('aba', 'Sacola');
    await novaArte(cliente, produto);
    expect(await codigoDoErro(novaArte(cliente, outroProduto))).toBeUndefined();
    expect(await codigoDoErro(novaArte(outroCliente, produto))).toBeUndefined();
  });

  it('rejeita produto de outra empresa', async () => {
    const cliente = await criarCliente('aba');
    const produtoDaRoma = await criarProduto('roma');
    expect(await codigoDoErro(novaArte(cliente, produtoDaRoma))).toBe(VIOLA_FK);
  });

  it('rejeita cliente de outra empresa', async () => {
    const clienteDaRoma = await criarCliente('roma');
    const produto = await criarProduto('aba');
    expect(
      await codigoDoErro(
        novaArte(clienteDaRoma, produto, { empresaId: (await empresa('aba')).id }),
      ),
    ).toBe(VIOLA_FK);
  });

  it('rejeita nome em branco e o mesmo arquivo em duas artes', async () => {
    const cliente = await criarCliente();
    const produto = await criarProduto();
    const [primeira] = await novaArte(cliente, produto);
    expect(await codigoDoErro(novaArte(cliente, produto, { nome: ' ' }))).toBe(VIOLA_CHECK);
    expect(
      await codigoDoErro(novaArte(cliente, produto, { nome: 'Outra', pdfId: primeira?.pdfId })),
    ).toBe(VIOLA_UNICO);
  });

  it('remove as máquinas junto com a arte', async () => {
    const cliente = await criarCliente();
    const produto = await criarProduto();
    const [arte] = await novaArte(cliente, produto);
    const [maquina] = await db.select().from(maquinas);
    if (!arte || !maquina) throw new Error('dados de apoio ausentes');
    await db.insert(arteMaquinas).values({ arteId: arte.id, maquinaId: maquina.id });

    await db.delete(artes).where(eq(artes.id, arte.id));

    expect(await db.$count(arteMaquinas)).toBe(0);
  });
});

describe('arquivos', () => {
  it('rejeita tamanho que não confere com o conteúdo e hash inválido', async () => {
    const conteudo = Buffer.from('%PDF-1.4');
    const base = {
      nomeOriginal: 'a.pdf',
      tipoMime: 'application/pdf',
      sha256: 'a'.repeat(64),
      conteudo,
    };
    expect(await codigoDoErro(db.insert(arquivos).values({ ...base, tamanho: 3 }))).toBe(
      VIOLA_CHECK,
    );
    expect(
      await codigoDoErro(
        db.insert(arquivos).values({ ...base, tamanho: conteudo.length, sha256: 'XYZ' }),
      ),
    ).toBe(VIOLA_CHECK);
  });
});

describe('semear-dev', () => {
  it('recusa host que não seja local', () => {
    expect(() => exigirBancoLocal('postgres://u:s@localhost:5433/rpa')).not.toThrow();
    expect(() => exigirBancoLocal('postgres://u:s@127.0.0.1:5433/rpa')).not.toThrow();
    expect(() => exigirBancoLocal('postgres://u:s@db.exemplo.com:5432/rpa')).toThrow(/localhost/);
    expect(() => exigirBancoLocal('postgres://u:s@localhost.exemplo.com/rpa')).toThrow(/localhost/);
    expect(() => exigirBancoLocal('texto qualquer')).toThrow(/inválida/);
  });

  it('popula clientes, produtos e artes, e pode ser repetido sem duplicar', async () => {
    const resumo = await semear(db);
    expect(resumo.clientes).toBe(CLIENTES_POR_EMPRESA * 2);
    expect(resumo.produtos).toBe(16);
    expect(resumo.artes).toBeGreaterThan(0);
    expect(await db.$count(usuarios)).toBe(2);

    const antes = await db.$count(artes);
    const repetido = await semear(db);
    expect(repetido).toEqual({ clientes: 0, produtos: 0, artes: 0 });
    expect(await db.$count(artes)).toBe(antes);
    expect(await db.$count(clientes)).toBe(CLIENTES_POR_EMPRESA * 2);
  });
});
