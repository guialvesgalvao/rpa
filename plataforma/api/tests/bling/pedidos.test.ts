import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { criarClienteBling } from '../../src/bling/cliente.js';
import {
  filtrosPedidos,
  lerPedidosAbertos,
  type PedidoAberto,
  SITUACAO_EM_ABERTO,
} from '../../src/bling/pedidos.js';
import { CLIENTE_FINAL_DESDE, criarTarefasDosPedidos } from '../../src/bling/tarefas-pedidos.js';
import { gerarCnpj, PDF_MINIMO } from '../../src/cli/semear-dev.js';
import { criarArte } from '../../src/artes/servico.js';
import {
  artes,
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
            data: '2026-11-08',
            contato: { id: 501, numeroDocumento: '11.222.333/0001-81' },
            transporte: { etiqueta: { nome: ' Pizzaria Ficticia ' } },
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
      {
        numero: '9001',
        contatoIdBling: 501,
        cnpj: '11222333000181',
        codigos: ['CX-35'],
        data: '2026-11-08',
        nomeEntrega: 'Pizzaria Ficticia',
      },
      {
        numero: '9002',
        contatoIdBling: 502,
        cnpj: null,
        codigos: [],
        data: null,
        nomeEntrega: null,
      },
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
      { empresaId: aba, nome: 'Caixa 35', codigo: '3500' },
      { empresaId: aba, nome: 'Caixa 40', codigo: '4000' },
    ]);
  });

  const pedido = (extra: Partial<PedidoAberto> = {}): PedidoAberto => ({
    numero: '9001',
    contatoIdBling: 501,
    cnpj: null,
    codigos: ['3500', '4000'],
    data: null,
    nomeEntrega: null,
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
    const [produto] = await db.select().from(produtos).where(eq(produtos.codigo, '3500'));
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
    const [outro] = await db.select().from(produtos).where(eq(produtos.codigo, '4000'));
    await db
      .insert(tarefasArte)
      .values({ empresaId: aba, clienteId, produtoId: outro!.id, status: 'cancelada' });

    const resultado = await criarTarefasDosPedidos(db, aba, [pedido()]);
    expect(resultado).toMatchObject({ criadas: 1, jaAtendidos: 1 });
  });

  it('insumo (código com letra) não vira tarefa nem conta como produto ausente', async () => {
    await db.insert(produtos).values({ empresaId: aba, nome: 'Tinta Ficticia', codigo: 'TPP001' });
    const resultado = await criarTarefasDosPedidos(db, aba, [
      pedido({ codigos: ['3500', 'TPP001', 'XYZ-9'] }),
    ]);
    expect(resultado).toMatchObject({ criadas: 1, semProduto: 0 });
    expect(await db.select().from(tarefasArte)).toHaveLength(1);
  });

  it('cliente pelo CNPJ quando o id do Bling não casa; fora da base: aviso só com contagens', async () => {
    const resultado = await criarTarefasDosPedidos(db, aba, [
      pedido({ contatoIdBling: 999, cnpj: CNPJ, codigos: ['3500', '999999'] }),
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
    const semDono = await criarTarefasDosPedidos(db, aba, [pedido({ codigos: ['3500'] })]);
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
    const resultado = await criarTarefasDosPedidos(db, aba, [pedido({ codigos: ['4000'] })]);
    expect(resultado).toMatchObject({ criadas: 1, semResponsavel: 0 });
    expect((await db.select().from(tarefasArte))[0]?.responsavelId).toBe(ids[1]);
  });

  describe('cliente final de revenda (ADR 0017)', () => {
    const NOVO = CLIENTE_FINAL_DESDE;
    const ANTIGO = '2026-11-01';
    const revenda = (numero: string, nomeEntrega: string | null, data = NOVO) =>
      pedido({ numero, codigos: ['3500'], data, nomeEntrega });

    const tarefas = () =>
      db
        .select({ clienteFinal: tarefasArte.clienteFinal, pedido: tarefasArte.pedidoNumero })
        .from(tarefasArte)
        .orderBy(tarefasArte.pedidoNumero);

    async function arteDe(clienteFinal: string | null) {
      const [produto] = await db.select().from(produtos).where(eq(produtos.codigo, '3500'));
      const usuario = await criarUsuario(db, {
        email: `adm${Math.random()}@exemplo.com`,
        nome: 'Admin Ficticio',
        perfil: 'admin',
        senha: 'senha-ficticia-123',
        empresas: ['aba'],
      });
      const arte = await criarArte(db, {
        empresaId: aba,
        clienteId,
        produtoId: produto!.id,
        usuarioId: usuario.id,
        nome: `Arte ${Math.random()}`,
        corId: (await db.select().from(cores).limit(1))[0]!.id,
        maquinaIds: [(await db.select().from(maquinas).limit(1))[0]!.id],
        pdf: { nomeOriginal: 'a.pdf', tipoMime: 'application/pdf', conteudo: PDF_MINIMO },
      });
      await db.update(artes).set({ clienteFinal }).where(eq(artes.id, arte.id));
    }

    it('revenda cria a tarefa com o cliente final; dois clientes finais, duas tarefas', async () => {
      const resultado = await criarTarefasDosPedidos(db, aba, [
        revenda('9001', 'Pizzaria Ficticia'),
        revenda('9002', 'Hamburgueria Exemplo'),
      ]);
      expect(resultado).toMatchObject({ criadas: 2, jaAtendidos: 0 });
      expect(await tarefas()).toEqual([
        { clienteFinal: 'Pizzaria Ficticia', pedido: '9001' },
        { clienteFinal: 'Hamburgueria Exemplo', pedido: '9002' },
      ]);
    });

    it('o mesmo cliente final com outra grafia não duplica (no ciclo e no seguinte)', async () => {
      const primeira = await criarTarefasDosPedidos(db, aba, [
        revenda('9001', 'Pizzaria Fictícia'),
        revenda('9002', 'PIZZARIA   FICTICIA'),
      ]);
      expect(primeira).toMatchObject({ criadas: 1 });
      const segunda = await criarTarefasDosPedidos(db, aba, [revenda('9003', 'pizzaria ficticia')]);
      expect(segunda).toMatchObject({ criadas: 0, jaAtendidos: 1 });
    });

    it('arte da revendedora sem cliente final não barra a revenda; com o mesmo cliente final, barra', async () => {
      await arteDe(null);
      expect(
        await criarTarefasDosPedidos(db, aba, [revenda('9001', 'Pizzaria Ficticia')]),
      ).toMatchObject({ criadas: 1 });
      await db.delete(tarefasArteHistorico);
      await db.delete(tarefasArte);
      await arteDe('Pizzaria Fictícia');
      expect(
        await criarTarefasDosPedidos(db, aba, [revenda('9002', 'pizzaria ficticia')]),
      ).toMatchObject({ criadas: 0, jaAtendidos: 1 });
      // Pedido da própria revendedora (sem cliente final): só as artes sem cliente final contam.
      expect(await criarTarefasDosPedidos(db, aba, [revenda('9003', null)])).toMatchObject({
        criadas: 0,
        jaAtendidos: 1,
      });
    });

    it('pedido sem cliente final, com só artes de clientes finais, gera tarefa', async () => {
      await arteDe('Pizzaria Ficticia');
      expect(await criarTarefasDosPedidos(db, aba, [revenda('9001', null)])).toMatchObject({
        criadas: 1,
      });
      expect(await tarefas()).toEqual([{ clienteFinal: null, pedido: '9001' }]);
    });

    it('nome de entrega igual ao do cliente não é cliente final', async () => {
      await criarTarefasDosPedidos(db, aba, [revenda('9001', 'CLIENTE FICTÍCIO LTDA')]);
      expect(await tarefas()).toEqual([{ clienteFinal: null, pedido: '9001' }]);
    });

    it('pedido anterior ao corte: regra antiga (arte existente barra), mas guarda o cliente final', async () => {
      const antes = await criarTarefasDosPedidos(db, aba, [
        revenda('9001', 'Pizzaria Ficticia', ANTIGO),
        revenda('9002', 'Hamburgueria Exemplo', ANTIGO),
      ]);
      expect(antes).toMatchObject({ criadas: 1 });
      expect(await tarefas()).toEqual([{ clienteFinal: 'Pizzaria Ficticia', pedido: '9001' }]);

      await db.delete(tarefasArteHistorico);
      await db.delete(tarefasArte);
      await arteDe(null);
      expect(
        await criarTarefasDosPedidos(db, aba, [revenda('9003', 'Pizzaria Ficticia', ANTIGO)]),
      ).toMatchObject({ criadas: 0, jaAtendidos: 1 });
      // Sem data: também a regra antiga.
      expect(
        await criarTarefasDosPedidos(db, aba, [
          pedido({ codigos: ['3500'], nomeEntrega: 'Outra' }),
        ]),
      ).toMatchObject({ criadas: 0, jaAtendidos: 1 });
    });
  });
});
