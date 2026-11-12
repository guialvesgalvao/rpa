import { describe, expect, it } from 'vitest';

import {
  estadoInicialPaginas,
  itensDaPagina,
  paginasVisiveis,
  redutorPaginas,
  totalDePaginas,
  type AcaoPaginas,
  type EstadoPaginas,
} from '../src/estado-paginas.ts';

const POR_PAGINA = 2;
const inicial = () => estadoInicialPaginas<string>(POR_PAGINA);

function aplicar(estado: EstadoPaginas<string>, ...acoes: AcaoPaginas<string>[]) {
  return acoes.reduce(redutorPaginas<string>, estado);
}

// Página 1 carregada com 5 itens no total (3 páginas).
function comPrimeiraPagina(): EstadoPaginas<string> {
  return aplicar(inicial(), {
    tipo: 'pagina_carregada',
    requisicao: 0,
    itens: ['a', 'b'],
    total: 5,
  });
}

describe('redutorPaginas', () => {
  it('começa carregando a página 1, sem total', () => {
    expect(inicial()).toMatchObject({
      pagina: 1,
      total: null,
      status: 'carregando',
      requisicao: 0,
      porPagina: POR_PAGINA,
    });
    expect(itensDaPagina(inicial())).toEqual([]);
  });

  it('guarda a página carregada e o total', () => {
    const estado = comPrimeiraPagina();
    expect(estado).toMatchObject({ status: 'ocioso', total: 5 });
    expect(itensDaPagina(estado)).toEqual(['a', 'b']);
  });

  it('escolher outra página faz uma requisição nova', () => {
    const estado = redutorPaginas(comPrimeiraPagina(), { tipo: 'pagina_escolhida', pagina: 3 });
    expect(estado).toMatchObject({ pagina: 3, status: 'carregando', requisicao: 1 });
    expect(itensDaPagina(estado)).toEqual([]);

    const carregada = redutorPaginas(estado, {
      tipo: 'pagina_carregada',
      requisicao: 1,
      itens: ['e'],
      total: 5,
    });
    expect(itensDaPagina(carregada)).toEqual(['e']);
  });

  it('voltar a uma página já vista usa o cache, sem requisição', () => {
    const naTerceira = aplicar(
      comPrimeiraPagina(),
      { tipo: 'pagina_escolhida', pagina: 3 },
      { tipo: 'pagina_carregada', requisicao: 1, itens: ['e'], total: 5 },
    );
    const devolta = redutorPaginas(naTerceira, { tipo: 'pagina_escolhida', pagina: 1 });
    expect(devolta).toMatchObject({ pagina: 1, status: 'ocioso' });
    expect(itensDaPagina(devolta)).toEqual(['a', 'b']);
  });

  it('escolher a página do cache descarta a carga em andamento', () => {
    const carregando = redutorPaginas(comPrimeiraPagina(), { tipo: 'pagina_escolhida', pagina: 2 });
    const devolta = redutorPaginas(carregando, { tipo: 'pagina_escolhida', pagina: 1 });
    const atrasada = redutorPaginas(devolta, {
      tipo: 'pagina_carregada',
      requisicao: carregando.requisicao,
      itens: ['c', 'd'],
      total: 5,
    });
    expect(atrasada).toBe(devolta);
    expect(itensDaPagina(atrasada)).toEqual(['a', 'b']);
  });

  it('limita a página escolhida ao intervalo e ignora a atual', () => {
    const estado = comPrimeiraPagina();
    expect(redutorPaginas(estado, { tipo: 'pagina_escolhida', pagina: 1 })).toBe(estado);
    expect(redutorPaginas(estado, { tipo: 'pagina_escolhida', pagina: 0 })).toBe(estado);
    expect(redutorPaginas(estado, { tipo: 'pagina_escolhida', pagina: Number.NaN })).toBe(estado);
    expect(redutorPaginas(estado, { tipo: 'pagina_escolhida', pagina: 99 }).pagina).toBe(3);
  });

  it('busca nova volta à página 1 e limpa o cache', () => {
    const naSegunda = aplicar(
      comPrimeiraPagina(),
      { tipo: 'pagina_escolhida', pagina: 2 },
      { tipo: 'pagina_carregada', requisicao: 1, itens: ['c', 'd'], total: 5 },
    );
    const buscando = redutorPaginas(naSegunda, { tipo: 'busca_alterada', busca: 'pad' });
    expect(buscando).toMatchObject({
      busca: 'pad',
      pagina: 1,
      total: null,
      cache: {},
      status: 'carregando',
      requisicao: 2,
    });
  });

  it('ignora a busca igual à atual', () => {
    const estado = comPrimeiraPagina();
    expect(redutorPaginas(estado, { tipo: 'busca_alterada', busca: '' })).toBe(estado);
  });

  it('descarta respostas de buscas antigas', () => {
    const buscando = redutorPaginas(inicial(), { tipo: 'busca_alterada', busca: 'pad' });
    const atrasada = redutorPaginas(buscando, {
      tipo: 'pagina_carregada',
      requisicao: 0,
      itens: ['velho'],
      total: 1,
    });
    expect(atrasada).toBe(buscando);
    expect(redutorPaginas(buscando, { tipo: 'falhou', requisicao: 0 })).toBe(buscando);
  });

  it('falha e tenta de novo a mesma página', () => {
    const naSegunda = redutorPaginas(comPrimeiraPagina(), { tipo: 'pagina_escolhida', pagina: 2 });
    const falhou = redutorPaginas(naSegunda, {
      tipo: 'falhou',
      requisicao: naSegunda.requisicao,
    });
    expect(falhou).toMatchObject({ status: 'erro', pagina: 2 });

    const tentando = redutorPaginas(falhou, { tipo: 'tentar_de_novo' });
    expect(tentando).toMatchObject({
      status: 'carregando',
      pagina: 2,
      requisicao: naSegunda.requisicao + 1,
    });
    // Só tenta de novo depois de um erro.
    expect(redutorPaginas(tentando, { tipo: 'tentar_de_novo' })).toBe(tentando);
  });

  it('escolher a mesma página depois de um erro também tenta de novo', () => {
    const falhou = redutorPaginas(inicial(), { tipo: 'falhou', requisicao: 0 });
    expect(redutorPaginas(falhou, { tipo: 'pagina_escolhida', pagina: 1 })).toMatchObject({
      status: 'carregando',
      requisicao: 1,
    });
  });

  it('esquece as outras páginas quando o total muda', () => {
    const naSegunda = aplicar(
      comPrimeiraPagina(),
      { tipo: 'pagina_escolhida', pagina: 2 },
      { tipo: 'pagina_carregada', requisicao: 1, itens: ['c', 'd'], total: 6 },
    );
    expect(naSegunda.total).toBe(6);
    expect(Object.keys(naSegunda.cache)).toEqual(['2']);
  });

  it('página além do fim (lista encolheu) vai para a última', () => {
    const naTerceira = aplicar(comPrimeiraPagina(), { tipo: 'pagina_escolhida', pagina: 3 });
    const vazia = redutorPaginas(naTerceira, {
      tipo: 'pagina_carregada',
      requisicao: naTerceira.requisicao,
      itens: [],
      total: 3,
    });
    expect(vazia).toMatchObject({
      pagina: 2,
      total: 3,
      status: 'carregando',
      requisicao: naTerceira.requisicao + 1,
    });
  });

  it('lista vazia fica na página 1, sem nova requisição', () => {
    const vazia = redutorPaginas(inicial(), {
      tipo: 'pagina_carregada',
      requisicao: 0,
      itens: [],
      total: 0,
    });
    expect(vazia).toMatchObject({ pagina: 1, total: 0, status: 'ocioso' });
    expect(itensDaPagina(vazia)).toEqual([]);
  });
});

describe('totalDePaginas', () => {
  it('arredonda para cima e nunca é menor que 1', () => {
    expect(totalDePaginas(0, 20)).toBe(1);
    expect(totalDePaginas(20, 20)).toBe(1);
    expect(totalDePaginas(21, 20)).toBe(2);
    expect(totalDePaginas(60, 20)).toBe(3);
  });
});

describe('paginasVisiveis', () => {
  it('mostra todas quando cabem', () => {
    expect(paginasVisiveis(1, 1)).toEqual([1]);
    expect(paginasVisiveis(2, 3)).toEqual([1, 2, 3]);
    expect(paginasVisiveis(3, 5)).toEqual([1, 2, 3, 4, 5]);
  });

  it('põe reticências nos buracos', () => {
    expect(paginasVisiveis(5, 9)).toEqual([1, '…', 4, 5, 6, '…', 9]);
    expect(paginasVisiveis(1, 9)).toEqual([1, 2, '…', 9]);
    expect(paginasVisiveis(9, 9)).toEqual([1, '…', 8, 9]);
  });

  it('mostra a página no lugar de reticências que esconderiam uma só', () => {
    expect(paginasVisiveis(4, 9)).toEqual([1, 2, 3, 4, 5, '…', 9]);
    expect(paginasVisiveis(6, 9)).toEqual([1, '…', 5, 6, 7, 8, 9]);
  });

  it('limita a atual ao intervalo e devolve vazio sem páginas', () => {
    expect(paginasVisiveis(0, 3)).toEqual([1, 2, 3]);
    expect(paginasVisiveis(99, 9)).toEqual([1, '…', 8, 9]);
    expect(paginasVisiveis(1, 0)).toEqual([]);
  });
});
