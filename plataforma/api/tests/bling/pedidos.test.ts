import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { criarClienteBling } from '../../src/bling/cliente.js';
import {
  filtrosPedidos,
  lerPedidosAbertos,
  type PedidoAberto,
  SITUACAO_EM_ABERTO,
} from '../../src/bling/pedidos.js';
import { criarTarefasDosPedidos } from '../../src/bling/tarefas-pedidos.js';
import { gerarCnpj, PDF_MINIMO } from '../../src/cli/semear-dev.js';
import { criarArte } from '../../src/artes/servico.js';
import {
  clientes,
  cores,
  empresas,
  maquinas,
  produtos,
  tarefasArte,
  tarefasArteHistorico,
} from '../../src/db/esquema.js';
import { definirResponsavelAutomatico } from '../../src/tarefas/responsavel.js';
import { criarUsuario } from '../../src/usuarios/servico.js';
import { criarBancoTeste, limparTabelas } from '../helpers/banco.js';

// Dados sintéticos: ids, números de pedido, CNPJs e códigos fictícios.
const { db, fechar } = criarBancoTeste();
afterAll(() => fechar());

const json = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { 'content-type': 'application/json' } });

// 2026-11-09 12:00 em Brasília.
const AGORA = new Date('2026-11-09T15:00:00Z');

describe('filtrosPedidos', () => {
  it('completa: em aberto e com data nos últimos 30 dias', () => {
    expect(filtrosPedidos({ tipo: 'completa' }, AGORA)).toEqual([
      { 'idsSituacoes[]': SITUACAO_EM_ABERTO, dataInicial: '2026-10-10' },
    ]);
  });

  it('incremental: alterados na janela e com data a partir do dia de `desde`, sempre dentro dos 30 dias', () => {
    const modo = {
      tipo: 'incremental',
      desde: new Date('2026-11-09T14:40:00Z'),
      ate: AGORA,
    } as const;
    expect(filtrosPedidos(modo, AGORA)).toEqual([
      {
        'idsSituacoes[]': SITUACAO_EM_ABERTO,
        dataInicial: '2026-10-10',
        dataAlteracaoInicial: '2026-11-09 11:40:00',
        dataAlteracaoFinal: '2026-11-09 12:00:00',
      },
      { 'idsSituacoes[]': SITUACAO_EM_ABERTO, dataInicial: '2026-11-09' },
    ]);
    const antigo = { ...modo, desde: new Date('2026-09-01T00:00:00Z') };
    expect(filtrosPedidos(antigo, AGORA)[1]).toMatchObject({ dataInicial: '2026-10-10' });
  });
});

describe('lerPedidosAbertos', () => {
  it('incremental: une as duas listagens pelo id, um detalhe por pedido', async () => {
    const urls: string[] = [];
    const fake = (async (entrada: string | URL | Request) => {
      const url = new URL(String(entrada));
      urls.push(`${url.pathname.replace('/Api/v3', '')}${url.search}`);
      if (url.pathname.endsWith('/pedidos/vendas'))
        return json({
          data: url.searchParams.has('dataAlteracaoInicial')
            ? [{ id: 11 }, { id: 12 }]
            : [{ id: 12 }],
        });
      return json({ data: { numero: 9001, contato: { id: 501 }, itens: [] } });
    }) as typeof fetch;
    const cliente = criarClienteBling({ fetch: fake, esperar: async () => {} });
    const modo = {
      tipo: 'incremental',
      desde: new Date('2026-11-09T14:40:00Z'),
      ate: AGORA,
    } as const;

    const pedidos = await lerPedidosAbertos(cliente, async () => 'acesso-ficticio', {
      modo,
      agora: AGORA,
    });

    expect(pedidos).toHaveLength(2);
    expect(urls.filter((u) => /^\/pedidos\/vendas\/\d+/.test(u))).toEqual([
      '/pedidos/vendas/11',
      '/pedidos/vendas/12',
    ]);
  });

  it('lista os em aberto e lê o detalhe de cada um; ignora item sem produto; respeita o 429', async () => {
    const urls: string[] = [];
    let recusou = false;
    const fake = (async (entrada: string | URL | Request) => {
      const url = new URL(String(entrada));
      urls.push(`${url.pathname.replace('/Api/v3', '')}${url.search}`);
      if (url.pathname.endsWith('/pedidos/vendas')) return json({ data: [{ id: 11 }, { id: 12 }] });
      if (url.pathname.endsWith('/pedidos/vendas/11') && !recusou) {
        recusou = true;
        return json({ error: { type: 'TOO_MANY_REQUESTS' } }, 429);
      }
      if (url.pathname.endsWith('/pedidos/vendas/11'))
        return json({
          data: {
            numero: 9001,
            contato: { id: 501, numeroDocumento: '11.222.333/0001-81' },
            itens: [
              { codigo: 'CX-35', produto: { id: 77 } },
              { codigo: 'CX-35', produto: { id: 77 } },
              { codigo: 'FRETE', produto: { id: 0 } },
              { codigo: null, produto: { id: 78 } },
            ],
          },
        });
      return json({
        data: {
          numero: '9002',
          contato: { id: 502, numeroDocumento: '123.456.789-09' },
          itens: [],
        },
      });
    }) as typeof fetch;
    const cliente = criarClienteBling({ fetch: fake, esperar: async () => {} });

    const pedidos = await lerPedidosAbertos(cliente, async () => 'acesso-ficticio', {
      agora: AGORA,
    });

    expect(pedidos).toEqual([
      { numero: '9001', contatoIdBling: 501, cnpj: '11222333000181', codigos: ['CX-35'] },
      { numero: '9002', contatoIdBling: 502, cnpj: null, codigos: [] },
    ]);
    expect(urls[0]).toContain(`idsSituacoes%5B%5D=${SITUACAO_EM_ABERTO}`);
    expect(urls[0]).toContain('dataInicial=2026-10-10');
    expect(urls.filter((u) => u.startsWith('/pedidos/vendas/11'))).toHaveLength(2);
  });
});

describe('criarTarefasDosPedidos', () => {
  let aba: string;
  let clienteId: string;
  const CNPJ = gerarCnpj(31);

  beforeEach(async () => {
    await limparTabelas(db);
    aba = (await db.select().from(empresas).where(eq(empresas.slug, 'aba')))[0]!.id;
    const [cliente] = await db
      .insert(clientes)
      .values({ empresaId: aba, razaoSocial: 'Cliente Ficticio Ltda', cnpj: CNPJ, idBling: 501 })
      .returning();
    clienteId = cliente!.id;
    await db.insert(produtos).values([
      { empresaId: aba, nome: 'Caixa 35', codigo: 'CX-35' },
      { empresaId: aba, nome: 'Caixa 40', codigo: 'CX-40' },
    ]);
  });

  const pedido = (extra: Partial<PedidoAberto> = {}): PedidoAberto => ({
    numero: '9001',
    contatoIdBling: 501,
    cnpj: null,
    codigos: ['CX-35', 'CX-40'],
    ...extra,
  });

  it('cria uma tarefa por produto, com origem e pedido; a segunda rodada não duplica', async () => {
    const ana = await criarUsuario(db, {
      email: 'ana@exemplo.com',
      nome: 'Ana Ficticia',
      perfil: 'arte_finalista',
      senha: 'senha-ficticia-123',
      empresas: ['aba'],
    });
    const primeira = await criarTarefasDosPedidos(db, aba, [pedido(), pedido({ numero: '9002' })]);
    expect(primeira).toMatchObject({ criadas: 2, jaAtendidos: 0, semResponsavel: 0 });
    expect(primeira.avisos).toEqual(['2 tarefa(s) de arte criada(s) a partir dos pedidos.']);
    const tarefas = await db.select().from(tarefasArte);
    expect(tarefas.map((t) => [t.origem, t.pedidoNumero, t.responsavelId])).toEqual([
      ['bling_pedido', '9001', ana.id],
      ['bling_pedido', '9001', ana.id],
    ]);
    const eventos = await db.select().from(tarefasArteHistorico);
    expect(eventos.every((e) => e.autorId === null)).toBe(true);

    const segunda = await criarTarefasDosPedidos(db, aba, [pedido()]);
    expect(segunda).toMatchObject({ criadas: 0, jaAtendidos: 2 });
    expect(await db.select().from(tarefasArte)).toHaveLength(2);
  });

  it('tarefa concluída ou cancelada não conta como aberta; arte existente sim', async () => {
    const [produto] = await db.select().from(produtos).where(eq(produtos.codigo, 'CX-35'));
    await criarArte(db, {
      empresaId: aba,
      clienteId,
      produtoId: produto!.id,
      usuarioId: (
        await criarUsuario(db, {
          email: 'adm@exemplo.com',
          nome: 'Admin Ficticio',
          perfil: 'admin',
          senha: 'senha-ficticia-123',
          empresas: ['aba'],
        })
      ).id,
      corId: (await db.select().from(cores).limit(1))[0]!.id,
      maquinaIds: [(await db.select().from(maquinas).limit(1))[0]!.id],
      pdf: { nomeOriginal: 'a.pdf', tipoMime: 'application/pdf', conteudo: PDF_MINIMO },
    });
    const [outro] = await db.select().from(produtos).where(eq(produtos.codigo, 'CX-40'));
    await db
      .insert(tarefasArte)
      .values({ empresaId: aba, clienteId, produtoId: outro!.id, status: 'cancelada' });

    const resultado = await criarTarefasDosPedidos(db, aba, [pedido()]);
    expect(resultado).toMatchObject({ criadas: 1, jaAtendidos: 1 });
  });

  it('cliente pelo CNPJ quando o id do Bling não casa; fora da base: aviso só com contagens', async () => {
    const resultado = await criarTarefasDosPedidos(db, aba, [
      pedido({ contatoIdBling: 999, cnpj: CNPJ, codigos: ['CX-35', 'NAO-EXISTE'] }),
      pedido({ numero: '9003', contatoIdBling: 998, cnpj: gerarCnpj(32) }),
    ]);
    expect(resultado).toMatchObject({ criadas: 1, semCliente: 1, semProduto: 1 });
    expect(resultado.avisos).toContain(
      '1 pedido(s) com cliente fora da base: nenhuma tarefa criada para eles.',
    );
    expect(resultado.avisos.join(' ')).not.toContain(CNPJ);
  });

  it('com duas arte finalistas e nenhuma escolhida: tarefa sem responsável e aviso', async () => {
    for (const email of ['ana@exemplo.com', 'bia@exemplo.com']) {
      await criarUsuario(db, {
        email,
        nome: email,
        perfil: 'arte_finalista',
        senha: 'senha-ficticia-123',
        empresas: ['aba'],
      });
    }
    const semDono = await criarTarefasDosPedidos(db, aba, [pedido({ codigos: ['CX-35'] })]);
    expect(semDono.semResponsavel).toBe(1);
    expect(semDono.avisos.join(' ')).toContain('sem responsável');
    expect((await db.select().from(tarefasArte))[0]?.responsavelId).toBeNull();
  });

  it('com a responsável escolhida, as tarefas vão para ela', async () => {
    const ids: string[] = [];
    for (const email of ['ana@exemplo.com', 'bia@exemplo.com']) {
      const u = await criarUsuario(db, {
        email,
        nome: email,
        perfil: 'arte_finalista',
        senha: 'senha-ficticia-123',
        empresas: ['aba'],
      });
      ids.push(u.id);
    }
    await definirResponsavelAutomatico(db, aba, ids[1]!);
    const resultado = await criarTarefasDosPedidos(db, aba, [pedido({ codigos: ['CX-40'] })]);
    expect(resultado).toMatchObject({ criadas: 1, semResponsavel: 0 });
    expect((await db.select().from(tarefasArte))[0]?.responsavelId).toBe(ids[1]);
  });
});
