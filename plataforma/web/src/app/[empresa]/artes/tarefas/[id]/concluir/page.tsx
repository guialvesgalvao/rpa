import { precisaDaArteParaConcluir, tituloTarefa } from '@plataforma/contratos';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { FormNovaArte } from '../../../../../../componentes/FormNovaArte';
import { opcoesNovaArte, tarefaDaEmpresa } from '../../../../../../servidor/artes';
import { exigirPermissaoNaPagina } from '../../../../../../servidor/eu';

export const metadata: Metadata = {
  title: 'Concluir tarefa · Plataforma RPA',
};

// O formulário de nova arte no modo conclusão: cliente e produto da tarefa; o envio cadastra a arte e conclui.
export default async function ConcluirTarefa({
  params,
}: PageProps<'/[empresa]/artes/tarefas/[id]/concluir'>) {
  const { empresa, id } = await params;
  await exigirPermissaoNaPagina(empresa, 'artes.adicionar');
  const [tarefa, opcoes] = await Promise.all([
    tarefaDaEmpresa(empresa, id),
    opcoesNovaArte(empresa),
  ]);
  if (!precisaDaArteParaConcluir(tarefa)) redirect(`/${empresa}/artes/tarefas/${tarefa.id}`);

  // O produto da tarefa pode ter saído do catálogo (inativado no Bling): continua como opção.
  const produtos = opcoes.produtos.some((p) => p.id === tarefa.produto.id)
    ? opcoes.produtos
    : [...opcoes.produtos, tarefa.produto];

  return (
    <div className="pagina">
      <p>
        <Link href={`/${empresa}/artes/tarefas/${tarefa.id}`}>← {tituloTarefa(tarefa)}</Link>
      </p>
      <div className="card">
        <h2>Concluir · {tituloTarefa(tarefa)}</h2>
        <FormNovaArte
          empresa={empresa}
          clienteId={tarefa.cliente.id}
          produtos={produtos}
          cores={opcoes.cores}
          maquinas={opcoes.maquinas}
          produtoInicial={tarefa.produto.id}
          produtoFixo
          envio={{
            url: `/api/v1/empresas/${encodeURIComponent(empresa)}/tarefas/${tarefa.id}/concluir`,
            destino: `/${empresa}/artes/tarefas/${tarefa.id}?concluida=1`,
          }}
        />
      </div>
    </div>
  );
}
