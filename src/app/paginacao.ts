import { criar } from './artes/dom.js';
import { paginasVisiveis, RETICENCIAS } from './plataforma/contratos.js';

export type OpcoesPaginacao = {
  paginaAtual: number;
  totalPaginas: number;
  total: number;
  /** Plural do que é listado ("clientes", "usuários"). */
  rotulo: string;
  aoEscolher: (pagina: number) => void;
};

/**
 * `‹ Anterior 1 … 4 5 6 … 9 Próxima ›`, com a página atual destacada e o total de itens (mesmos controles
 * do site). Com uma página só, devolve `null`: a tela não mostra controles.
 */
export function montarPaginacao({
  paginaAtual,
  totalPaginas,
  total,
  rotulo,
  aoEscolher,
}: OpcoesPaginacao): HTMLElement | null {
  if (totalPaginas <= 1) return null;

  const controle = (pagina: number, texto: string, rotuloAcessivel?: string) => {
    const atual = pagina === paginaAtual;
    const botao = criar('button', undefined, texto);
    botao.type = 'button';
    botao.disabled = pagina < 1 || pagina > totalPaginas;
    if (atual) botao.setAttribute('aria-current', 'page');
    if (rotuloAcessivel) botao.setAttribute('aria-label', rotuloAcessivel);
    botao.addEventListener('click', () => {
      if (!atual) aoEscolher(pagina);
    });
    const item = criar('li');
    item.append(botao);
    return item;
  };

  const lista = criar('ul');
  lista.append(controle(paginaAtual - 1, '‹ Anterior'));
  for (const item of paginasVisiveis(paginaAtual, totalPaginas)) {
    if (item === RETICENCIAS) {
      const reticencias = criar('li');
      reticencias.append(criar('span', 'hint', RETICENCIAS));
      lista.append(reticencias);
    } else {
      lista.append(controle(item, String(item), `Página ${item}`));
    }
  }
  lista.append(controle(paginaAtual + 1, 'Próxima ›'));

  const resumo = criar(
    'p',
    'hint',
    `Página ${paginaAtual} de ${totalPaginas} · ${total} ${rotulo}`,
  );
  resumo.setAttribute('role', 'status');

  const nav = criar('nav', 'paginacao');
  nav.setAttribute('aria-label', `Páginas de ${rotulo}`);
  nav.append(lista, resumo);
  return nav;
}
