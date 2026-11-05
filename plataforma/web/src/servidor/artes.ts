import 'server-only';

import {
  EsquemaCliente,
  EsquemaEventoTarefa,
  EsquemaOpcao,
  EsquemaProdutoDoCliente,
  EsquemaTarefa,
  EsquemaTarefaDetalhe,
  type Cliente,
  type EscopoTarefas,
  type EventoTarefa,
  type Opcao,
  type ProdutoDoCliente,
  type StatusTarefa,
  type Tarefa,
  type TarefaDetalhe,
} from '@plataforma/contratos';
import { cookies } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { z } from 'zod';

import { criarApi } from './api';
import { lerConfig } from './config';
import { COOKIE_ACESSO } from './sessao';

// Leitura da API pelas páginas (servidor), com o token do cookie. Sessão recusada → `/entrar`; 404 → página 404.
async function lerDaApi<T>(caminho: string, esquema: z.ZodType<T>): Promise<T> {
  const acesso = (await cookies()).get(COOKIE_ACESSO)?.value;
  if (!acesso) redirect('/entrar');

  const api = criarApi({ url: lerConfig().apiUrl });
  let resposta: Response;
  try {
    resposta = await api.repassar(api.endereco(caminho), {
      headers: { authorization: `Bearer ${acesso}` },
      cache: 'no-store',
    });
  } catch (erro) {
    throw new Error(`API indisponível em ${caminho}.`, { cause: erro });
  }
  if (resposta.status === 401) redirect('/entrar');
  if (resposta.status === 404 || resposta.status === 403) notFound();
  if (!resposta.ok) throw new Error(`A API respondeu ${resposta.status} em ${caminho}.`);
  return esquema.parse(await resposta.json());
}

const base = (empresa: string) => `/v1/empresas/${encodeURIComponent(empresa)}`;

export const clienteDaEmpresa = (empresa: string, id: string): Promise<Cliente> =>
  lerDaApi(`${base(empresa)}/clientes/${encodeURIComponent(id)}`, EsquemaCliente);

export const produtosDoCliente = (empresa: string, id: string): Promise<ProdutoDoCliente[]> =>
  lerDaApi(
    `${base(empresa)}/clientes/${encodeURIComponent(id)}/produtos`,
    z.array(EsquemaProdutoDoCliente),
  );

export type OpcoesNovaArte = { produtos: Opcao[]; cores: Opcao[]; maquinas: Opcao[] };

export async function opcoesNovaArte(empresa: string): Promise<OpcoesNovaArte> {
  const lista = z.array(EsquemaOpcao);
  const [produtos, cores, maquinas] = await Promise.all([
    lerDaApi(`${base(empresa)}/produtos`, lista),
    lerDaApi('/v1/cores', lista),
    lerDaApi('/v1/maquinas', lista),
  ]);
  return { produtos, cores, maquinas };
}

// Catálogo da empresa (os produtos do Bling): o mesmo para todos os clientes.
export const produtosDaEmpresa = (empresa: string): Promise<Opcao[]> =>
  lerDaApi(`${base(empresa)}/produtos`, z.array(EsquemaOpcao));

export function tarefasDaEmpresa(
  empresa: string,
  consulta: { escopo: EscopoTarefas; status?: StatusTarefa },
): Promise<Tarefa[]> {
  const params = new URLSearchParams({ escopo: consulta.escopo });
  if (consulta.status) params.set('status', consulta.status);
  return lerDaApi(`${base(empresa)}/tarefas?${params}`, z.array(EsquemaTarefa));
}

export const tarefaDaEmpresa = (empresa: string, id: string): Promise<TarefaDetalhe> =>
  lerDaApi(`${base(empresa)}/tarefas/${encodeURIComponent(id)}`, EsquemaTarefaDetalhe);

export const historicoDaTarefa = (empresa: string, id: string): Promise<EventoTarefa[]> =>
  lerDaApi(
    `${base(empresa)}/tarefas/${encodeURIComponent(id)}/historico`,
    z.array(EsquemaEventoTarefa),
  );
