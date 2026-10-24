import { describe, expect, it } from 'vitest';

import { mensagemNfRecusada } from '../../../src/processes/bling/nota-fiscal.js';

const FRETE =
  'NF não criada: o item Frete do pedido não tem os dados fiscais exigidos pelo Bling (unidade, NCM, Cód. Lista Serviços) — verifique no Bling';

/** Textos no formato do aviso do Bling (achado da Task 7), com itens fictícios. */
const problemaFrete =
  'Problema com o item 2 - Frete: unidade e o Cód. Lista Serviços e o NCM (para serviços utilizar o valor 00) deve(m) ser preenchido(s).';
const cfopFrete = 'O CFOP () do item 2 - Frete não é um CFOP válido para o uso';
const problemaProduto =
  'Problema com o item 1 - Produto Exemplo: CFOP e a situação tributária do PIS deve(m) ser preenchido(s).';
const texto = 'Atenção Não foi possível salvar a Nota Fiscal Verifique as informações abaixo.';

describe('mensagemNfRecusada', () => {
  it('só o Frete: descrição específica', () => {
    expect(mensagemNfRecusada([problemaFrete], texto)).toBe(FRETE);
  });

  it('vários problemas do Frete viram uma descrição só', () => {
    expect(mensagemNfRecusada([cfopFrete, problemaFrete], texto)).toBe(FRETE);
  });

  it('Frete e outro item: descrição específica e os outros problemas', () => {
    expect(mensagemNfRecusada([problemaFrete, `  ${problemaProduto}\n`], texto)).toBe(
      `${FRETE}. Outros problemas: ${problemaProduto}`,
    );
  });

  it('sem Frete: os problemas do Bling', () => {
    expect(mensagemNfRecusada([problemaProduto], texto)).toBe(`NF não criada: ${problemaProduto}`);
  });

  it('não confunde item com "Frete" no meio do nome', () => {
    const outro = 'Problema com o item 3 - Fretesa Azul: NCM deve(m) ser preenchido(s).';
    expect(mensagemNfRecusada([outro], texto)).toBe(`NF não criada: ${outro}`);
  });

  it('sem lista de problemas: usa o texto do aviso, sem o "Atenção"', () => {
    expect(mensagemNfRecusada([], texto)).toBe(
      'NF não criada: Não foi possível salvar a Nota Fiscal Verifique as informações abaixo.',
    );
  });
});
