import { describe, expect, it } from 'vitest';

import {
  MAX_PEDIDOS_OP,
  validarCnpj,
  validarComentario,
  validarConclusao,
  validarConsultaTarefas,
  validarItemOp,
  validarItensOp,
  validarLogin,
  validarMudancaStatus,
  validarNovaTarefa,
  validarNovoUsuario,
  validarNumerosOp,
  validarSelecao,
  validarSlug,
  validarTrocaSenha,
} from '../../src/app/validacao.js';
import { PASSOS_PROCESSO } from '../../src/processes/op/template.js';

describe('validarSelecao', () => {
  it('aceita a seleção e remove pedidos sem documento', () => {
    expect(
      validarSelecao([
        { numero: '2604', docs: ['boleto', 'recibo'] },
        { numero: '2605', docs: [] },
      ]),
    ).toEqual([{ numero: '2604', docs: ['boleto', 'recibo'] }]);
  });

  it('documento repetido conta uma vez', () => {
    expect(validarSelecao([{ numero: '1', docs: ['boleto', 'boleto'] }])).toEqual([
      { numero: '1', docs: ['boleto'] },
    ]);
  });

  it('recusa número que não é só dígitos', () => {
    expect(() => validarSelecao([{ numero: '12a', docs: ['boleto'] }])).toThrow(
      'Seleção inválida: Número de pedido inválido',
    );
  });

  it('recusa documento fora do enum', () => {
    expect(() => validarSelecao([{ numero: '1', docs: ['danfe'] }])).toThrow(/^Seleção inválida/);
  });

  it('recusa formato inesperado', () => {
    expect(() => validarSelecao('2604')).toThrow(/^Seleção inválida/);
    expect(() => validarSelecao(undefined)).toThrow(/^Seleção inválida/);
  });

  it('recusa seleção sem nenhum documento', () => {
    expect(() => validarSelecao([])).toThrow('Selecione ao menos um pedido com um documento.');
    expect(() => validarSelecao([{ numero: '1', docs: [] }])).toThrow(
      'Selecione ao menos um pedido com um documento.',
    );
  });
});

describe('validarLogin', () => {
  it('aceita e-mail e senha, aparando o e-mail', () => {
    expect(validarLogin({ email: ' ana@exemplo.com ', senha: 'segredo' })).toEqual({
      email: 'ana@exemplo.com',
      senha: 'segredo',
    });
  });

  it('não altera a senha', () => {
    expect(validarLogin({ email: 'a@b.c', senha: ' com espaço ' }).senha).toBe(' com espaço ');
  });

  it('recusa campos vazios, ausentes ou de outro tipo', () => {
    for (const input of [
      { email: '', senha: 'x' },
      { email: 'a@b.c', senha: '' },
      { email: '   ', senha: 'x' },
      { email: 'a@b.c' },
      { email: 1, senha: 'x' },
      undefined,
    ]) {
      expect(() => validarLogin(input)).toThrow('Informe o e-mail e a senha.');
    }
  });

  it('recusa e-mail ou senha com mais de 200 caracteres', () => {
    expect(() => validarLogin({ email: 'a'.repeat(201), senha: 'x' })).toThrow();
    expect(() => validarLogin({ email: 'a@b.c', senha: 'x'.repeat(201) })).toThrow();
    expect(validarLogin({ email: 'a@b.c', senha: 'x'.repeat(200) }).senha).toHaveLength(200);
  });
});

describe('validarSlug', () => {
  it('aceita o slug e apara os espaços', () => {
    expect(validarSlug(' roma ')).toBe('roma');
  });

  it('recusa o que não é um slug', () => {
    for (const input of ['', '   ', 'a'.repeat(101), 1, null, undefined, { slug: 'aba' }]) {
      expect(() => validarSlug(input)).toThrow('Empresa inválida.');
    }
  });
});

describe('validarCnpj', () => {
  it('aceita com ou sem máscara e devolve os 14 dígitos', () => {
    expect(validarCnpj('12.345.678/0001-90')).toBe('12345678000190');
    expect(validarCnpj('12345678000190')).toBe('12345678000190');
  });

  it('recusa CNPJ incompleto, CPF, texto grande e tipo errado', () => {
    for (const entrada of [
      '1234567800019',
      '123.456.789-09',
      '1'.repeat(31),
      12345678000190,
      null,
    ]) {
      expect(() => validarCnpj(entrada)).toThrow('CNPJ inválido.');
    }
  });
});

describe('validarItemOp', () => {
  const clienteId = '3f0c6d2e-8a41-4b5e-9d3a-1c2b3d4e5f60';

  it('aceita cliente e código, sem espaços nas pontas', () => {
    expect(validarItemOp({ clienteId, codigo: ' RA0012 ' })).toEqual({
      clienteId,
      codigo: 'RA0012',
    });
  });

  it('recusa cliente fora do formato e código vazio ou longo', () => {
    for (const entrada of [
      { clienteId: 'x', codigo: 'RA0012' },
      { clienteId, codigo: '   ' },
      { clienteId, codigo: 'A'.repeat(101) },
      { clienteId },
      null,
    ]) {
      expect(() => validarItemOp(entrada)).toThrow('Item da OP inválido.');
    }
  });
});

describe('validarNumerosOp', () => {
  it('aceita números de pedido e remove repetidos, na ordem', () => {
    expect(validarNumerosOp(['2604', '2683', '2604'])).toEqual(['2604', '2683']);
  });

  it('recusa lista vazia, longa demais, ou com texto', () => {
    const muitos = Array.from({ length: MAX_PEDIDOS_OP + 1 }, (_, i) => String(i + 1));
    for (const entrada of [[], muitos, ['12a'], [''], 'x', null]) {
      expect(() => validarNumerosOp(entrada)).toThrow('Números de pedido inválidos.');
    }
  });
});

describe('validarItensOp', () => {
  const arteId = '3f0c6d2e-8a41-4b5e-9d3a-1c2b3d4e5f60';

  it('aceita itens com e sem arte; item repetido conta uma vez', () => {
    expect(
      validarItensOp([
        { numero: '9001', indice: 0, arteId },
        { numero: '9001', indice: 1 },
        { numero: '9001', indice: 0 },
      ]),
    ).toEqual([
      { numero: '9001', indice: 0, arteId },
      { numero: '9001', indice: 1 },
    ]);
  });

  it('aceita o pré-preenchimento e o devolve normalizado; vazio some', () => {
    const processo = Array.from({ length: PASSOS_PROCESSO.length }, () => ({}));
    processo[0] = { aplica: 'sim', quantidade: ' 10 ', data: '2026-11-03' };
    expect(
      validarItensOp([
        { numero: '9001', indice: 0, preenchimento: { dataEntrega: '2026-11-20', processo } },
        { numero: '9001', indice: 1, preenchimento: { dataEntrega: '', observacao: ' ' } },
      ]),
    ).toEqual([
      {
        numero: '9001',
        indice: 0,
        preenchimento: {
          dataEntrega: '2026-11-20',
          processo: [{ aplica: 'sim', quantidade: '10', data: '2026-11-03' }, ...processo.slice(1)],
        },
      },
      { numero: '9001', indice: 1 },
    ]);
  });

  it('recusa pré-preenchimento com data inválida, processo incompleto ou texto longo', () => {
    const item = (preenchimento: unknown) => [{ numero: '9001', indice: 0, preenchimento }];
    for (const preenchimento of [
      { dataEntrega: '20/11/2026' },
      { dataEntrega: '2026-02-30' },
      { processo: [{ aplica: 'sim' }] },
      { processo: Array.from({ length: PASSOS_PROCESSO.length }, () => ({ aplica: 'talvez' })) },
      {
        processo: Array.from({ length: PASSOS_PROCESSO.length }, () => ({
          responsavel: 'x'.repeat(29),
        })),
      },
      { observacao: 'x'.repeat(401) },
    ]) {
      expect(() => validarItensOp(item(preenchimento))).toThrow('Seleção de produtos inválida.');
    }
  });

  it('recusa lista vazia, índice negativo, arte fora do formato e número com texto', () => {
    expect(() => validarItensOp([])).toThrow('Marque ao menos um produto.');
    for (const entrada of [
      [{ numero: '9001', indice: -1 }],
      [{ numero: '9001', indice: 0, arteId: 'x' }],
      [{ numero: '90a', indice: 0 }],
      null,
    ]) {
      expect(() => validarItensOp(entrada)).toThrow('Seleção de produtos inválida.');
    }
  });
});

describe('tarefas de arte', () => {
  const id = '3f0c6d2e-8a41-4b5e-9d3a-1c2b3d4e5f60';

  it('nova tarefa: cliente e produto por id', () => {
    expect(validarNovaTarefa({ clienteId: id, produtoId: id })).toEqual({
      clienteId: id,
      produtoId: id,
    });
    expect(() => validarNovaTarefa({ clienteId: id, produtoId: 'x' })).toThrow(
      'Cliente ou produto inválido.',
    );
  });

  it('filtro: escopo e status conhecidos', () => {
    expect(validarConsultaTarefas({ escopo: 'minhas', status: 'concluida' })).toEqual({
      escopo: 'minhas',
      status: 'concluida',
    });
    for (const entrada of [{ escopo: 'outras' }, { escopo: 'todas', status: 'pausada' }, null]) {
      expect(() => validarConsultaTarefas(entrada)).toThrow('Filtro de tarefas inválido.');
    }
  });

  it('status: id e status conhecidos', () => {
    expect(validarMudancaStatus({ id, status: 'cancelada' })).toEqual({ id, status: 'cancelada' });
    expect(() => validarMudancaStatus({ id, status: 'pausada' })).toThrow('Status inválido.');
  });

  it('comentário: aparado, nem vazio nem longo demais', () => {
    expect(validarComentario({ id, texto: '  ok ' })).toEqual({ id, texto: 'ok' });
    for (const texto of ['  ', 'x'.repeat(2001)]) {
      expect(() => validarComentario({ id, texto })).toThrow('Escreva um comentário');
    }
  });

  it('conclusão: os campos do cadastro, sem o cliente e com a tarefa', () => {
    const entrada = { tarefaId: id, produtoId: id, nome: '', corId: id, maquinaIds: [id] };
    expect(validarConclusao(entrada)).toEqual(entrada);
    expect(() => validarConclusao({ ...entrada, tarefaId: 'x' })).toThrow(
      'Dados da arte inválidos.',
    );
  });
});

describe('usuários e senha', () => {
  const novo = {
    nome: 'Ana Ficticia',
    email: 'Ana@Exemplo.com',
    perfil: 'arte_finalista',
    empresas: ['aba'],
    senha: 'senha-inicial-123',
  };

  it('novo usuário: normaliza o e-mail; recusa com a mensagem do primeiro problema', () => {
    expect(validarNovoUsuario(novo)).toMatchObject({ email: 'ana@exemplo.com' });
    expect(() => validarNovoUsuario({ ...novo, empresas: [] })).toThrow(
      'Escolha ao menos uma empresa.',
    );
    expect(() => validarNovoUsuario({ ...novo, senha: 'curta' })).toThrow(
      'A senha precisa de ao menos 10 caracteres.',
    );
    expect(() => validarNovoUsuario('x')).toThrow();
  });

  it('troca de senha: exige a atual e a nova com o mínimo', () => {
    expect(validarTrocaSenha({ senhaAtual: 'a', novaSenha: 'senha-nova-123' })).toEqual({
      senhaAtual: 'a',
      novaSenha: 'senha-nova-123',
    });
    expect(() => validarTrocaSenha({ senhaAtual: '', novaSenha: 'senha-nova-123' })).toThrow(
      'Informe a senha atual.',
    );
    expect(() => validarTrocaSenha({ senhaAtual: 'a', novaSenha: 'curta' })).toThrow(
      'A nova senha precisa de ao menos 10 caracteres.',
    );
  });
});
