import { describe, expect, it } from 'vitest';

import { estadoInicial, redutorLista, type EstadoLista } from '../src/estado-lista.ts';

const inicial = () => estadoInicial<string>();

function comPrimeiraPagina(): EstadoLista<string> {
  return redutorLista(inicial(), {
    tipo: 'pagina_carregada',
    requisicao: 0,
    itens: ['a', 'b'],
    proximoCursor: 'c1',
  });
}

describe('redutorLista', () => {
  it('começa carregando, sem itens', () => {
    expect(inicial()).toMatchObject({ status: 'carregando', itens: [], fim: false });
  });

  it('acrescenta a página nova e guarda o cursor', () => {
    const estado = comPrimeiraPagina();
    expect(estado).toMatchObject({ itens: ['a', 'b'], proximoCursor: 'c1', status: 'ocioso' });

    const proxima = redutorLista(redutorLista(estado, { tipo: 'carregar_mais' }), {
      tipo: 'pagina_carregada',
      requisicao: 1,
      itens: ['c'],
      proximoCursor: null,
    });
    expect(proxima.itens).toEqual(['a', 'b', 'c']);
  });

  it('marca o fim quando o cursor é null e não carrega mais', () => {
    const fim = redutorLista(inicial(), {
      tipo: 'pagina_carregada',
      requisicao: 0,
      itens: ['a'],
      proximoCursor: null,
    });
    expect(fim.fim).toBe(true);
    expect(redutorLista(fim, { tipo: 'carregar_mais' })).toBe(fim);
  });

  it('não pede outra página enquanto uma carga está em andamento', () => {
    const carregando = redutorLista(comPrimeiraPagina(), { tipo: 'carregar_mais' });
    expect(redutorLista(carregando, { tipo: 'carregar_mais' })).toBe(carregando);
  });

  it('busca nova descarta as páginas antigas e reinicia o cursor', () => {
    const estado = redutorLista(comPrimeiraPagina(), { tipo: 'busca_alterada', busca: 'ana' });
    expect(estado).toMatchObject({
      busca: 'ana',
      itens: [],
      proximoCursor: null,
      status: 'carregando',
      requisicao: 1,
    });
  });

  it('ignora a resposta de uma busca antiga', () => {
    const nova = redutorLista(comPrimeiraPagina(), { tipo: 'busca_alterada', busca: 'ana' });
    const atrasada = redutorLista(nova, {
      tipo: 'pagina_carregada',
      requisicao: 0,
      itens: ['velho'],
      proximoCursor: null,
    });
    expect(atrasada).toBe(nova);
    expect(redutorLista(nova, { tipo: 'falhou', requisicao: 0 })).toBe(nova);
  });

  it('mantém o estado quando a busca não muda', () => {
    const estado = comPrimeiraPagina();
    expect(redutorLista(estado, { tipo: 'busca_alterada', busca: '' })).toBe(estado);
  });

  it('erro mantém os itens e "tentar de novo" volta a carregar do mesmo cursor', () => {
    const carregando = redutorLista(comPrimeiraPagina(), { tipo: 'carregar_mais' });
    const erro = redutorLista(carregando, { tipo: 'falhou', requisicao: 1 });
    expect(erro).toMatchObject({ status: 'erro', itens: ['a', 'b'], proximoCursor: 'c1' });

    const tentando = redutorLista(erro, { tipo: 'tentar_de_novo' });
    expect(tentando).toMatchObject({ status: 'carregando', requisicao: 2, proximoCursor: 'c1' });
  });
});
