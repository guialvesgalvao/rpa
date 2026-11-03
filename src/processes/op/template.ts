import type { ImagemOp, OrdemProducao } from './tipos.js';

/** Passos fixos da tabela "Descrição do Processo" (`table-example.jpeg`). */
export const PASSOS_PROCESSO = [
  'Guilhotina',
  'Off-Set',
  'Inspeção Visual',
  'Verniz Máquina',
  'Acoplagem',
  'Corte e Vinco',
  'Montagem',
  'Inspeção Final',
  'Despacho',
] as const;

/** Altura da caixa de Observação; a imagem da arte tem o dobro. */
const ALTURA_OBSERVACAO_MM = 22;
export const ALTURA_ARTE_MM = ALTURA_OBSERVACAO_MM * 2;

const DATA_EM_BRANCO = '__/__/____';
const MIMES_IMAGEM = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escaparHtml(texto: string): string {
  return texto.replace(/[&<>"']/g, (c) => ESCAPES[c] ?? c);
}

const doisDigitos = (n: number): string => String(n).padStart(2, '0');

/** Ex.: 26/10/2026, pela data local. */
export function formatarDataOp(d: Date | undefined): string {
  if (!d) return DATA_EM_BRANCO;
  return `${doisDigitos(d.getDate())}/${doisDigitos(d.getMonth() + 1)}/${d.getFullYear()}`;
}

/** Ex.: 1000 → "1.000,00". */
export function formatarQuantidade(n: number): string {
  return n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function dataUrl({ bytes, mime }: ImagemOp): string {
  if (!MIMES_IMAGEM.has(mime)) throw new Error(`Tipo de imagem não suportado na OP: ${mime}`);
  return `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`;
}

const CSS = `
@page { size: A4; margin: 10mm 12mm; }
* { box-sizing: border-box; }
html, body { margin: 0; }
body { font-family: Arial, Helvetica, sans-serif; font-size: 9pt; color: #333; }
h1 { font-size: 16pt; margin: 0 0 2mm; }
h2 { font-size: 11pt; margin: 4mm 0 1.5mm; }
.topo { display: flex; justify-content: space-between; align-items: flex-start; }
.topo .data { font-size: 11pt; font-weight: bold; }
.topo .empresa { font-size: 16pt; font-weight: bold; text-align: right; }
.topo .logo { max-height: 20mm; max-width: 60mm; }
.caixa { border: 1px solid #999; border-radius: 3px; }
.cliente { display: flex; justify-content: space-between; gap: 6mm; margin-top: 3mm; padding: 2mm 3mm; }
.cliente .rotulo { font-size: 8pt; color: #666; display: block; }
.cliente .valor { font-size: 11pt; font-weight: bold; }
.cliente .pedido { text-align: right; white-space: nowrap; }
.datas { display: flex; gap: 3mm; margin-top: 3mm; }
.datas .caixa { flex: 1; display: flex; padding: 2mm; }
.datas .campo { flex: 1; text-align: center; }
.datas .rotulo { font-size: 8pt; display: block; margin-bottom: 1mm; }
.datas .valor { font-size: 13pt; font-weight: bold; }
table { width: 100%; border-collapse: collapse; }
.tabela th, .tabela td { border: 1px solid #bbb; padding: 1.2mm 2mm; text-align: left; }
.tabela th { font-size: 8pt; background: #f2f2f2; }
.tabela td { font-weight: bold; }
.tabela .num { text-align: right; white-space: nowrap; }
.processo th, .processo td { border: 1px solid #999; padding: 1mm 1.5mm; height: 6.5mm; }
.processo th { background: #e6e6e6; font-size: 8.5pt; }
.processo td { font-size: 9pt; }
.processo .marca { text-align: center; width: 9mm; }
.processo .passo { font-weight: bold; width: 34mm; }
.processo .data { text-align: center; width: 30mm; }
.observacao { height: ${ALTURA_OBSERVACAO_MM}mm; padding: 2mm 3mm; white-space: pre-wrap; overflow: hidden; }
.arte { display: flex; gap: 4mm; margin-top: 4mm; }
.arte .imagem { flex: 0 0 auto; height: ${ALTURA_ARTE_MM}mm; max-width: 110mm; display: flex; align-items: center; justify-content: center; }
.arte .imagem img { height: 100%; max-width: 100%; object-fit: contain; }
.arte .sem-imagem { width: 60mm; color: #888; font-style: italic; }
.arte .detalhes { flex: 1; font-size: 10pt; }
.arte .detalhes p { margin: 0 0 3mm; }
.arte .detalhes .rotulo { font-size: 8pt; color: #666; display: block; }
.arte .detalhes .valor { font-weight: bold; }
section { break-inside: avoid; }
`;

function cabecalho(op: OrdemProducao): string {
  const marca = op.logo
    ? `<img class="logo" src="${dataUrl(op.logo)}" alt="${escaparHtml(op.empresa)}">`
    : `<div class="empresa">${escaparHtml(op.empresa)}</div>`;
  return `<header class="topo">
  <div>
    <h1>Ordem de Produção nº ${op.numero}</h1>
    <div class="data">Data: ${formatarDataOp(op.data)}</div>
  </div>
  ${marca}
</header>`;
}

function blocoCliente(op: OrdemProducao): string {
  const cliente = op.cliente.fantasia?.trim() || op.cliente.nome;
  return `<section class="caixa cliente">
  <div><span class="rotulo">Cliente</span><span class="valor">${escaparHtml(cliente)}</span></div>
  <div class="pedido"><span class="rotulo">Nº do pedido</span><span class="valor">${escaparHtml(op.numeroPedido)}</span></div>
</section>`;
}

const campoData = (rotulo: string, valor: Date | undefined): string =>
  `<div class="campo"><span class="rotulo">${rotulo}</span><span class="valor">${formatarDataOp(valor)}</span></div>`;

function blocoDatas(op: OrdemProducao): string {
  return `<section class="datas">
  <div class="caixa">${campoData('Previsão inicial', op.previsaoInicial)}${campoData('Previsão final', op.previsaoFinal)}</div>
  <div class="caixa">${campoData('Data início de produção', op.data)}${campoData('Data entrega de produção', undefined)}</div>
</section>`;
}

function blocoItem({ item }: OrdemProducao): string {
  return `<section>
  <h2>Item para produção</h2>
  <table class="tabela">
    <thead><tr><th>Descrição</th><th>Código</th><th>Unidade</th><th class="num">Quantidade a produzir</th></tr></thead>
    <tbody><tr>
      <td>${escaparHtml(item.descricao)}</td>
      <td>${escaparHtml(item.codigo)}</td>
      <td>${escaparHtml(item.unidade)}</td>
      <td class="num">${formatarQuantidade(item.quantidade)}</td>
    </tr></tbody>
  </table>
</section>`;
}

function blocoInsumos({ insumos, item }: OrdemProducao): string {
  const linhas = insumos
    .map(
      (i) => `<tr>
      <td>${escaparHtml(i.nome)}</td>
      <td>${escaparHtml(i.unidade)}</td>
      <td class="num">${formatarQuantidade(i.quantidadePorUnidade)}</td>
      <td class="num">${formatarQuantidade(i.quantidadePorUnidade * item.quantidade)}</td>
    </tr>`,
    )
    .join('');
  return `<section>
  <h2>Insumos (matéria prima)</h2>
  <table class="tabela">
    <thead><tr><th>Descrição</th><th>Unidade</th><th class="num">Qtde un.</th><th class="num">Qtde total</th></tr></thead>
    <tbody>${linhas}</tbody>
  </table>
</section>`;
}

function blocoProcesso(): string {
  const linhas = PASSOS_PROCESSO.map(
    (passo, i) => `<tr>
      <td class="passo">${i + 1}) ${passo}</td>
      <td class="marca">( )</td><td class="marca">( )</td>
      <td></td><td></td>
      <td class="data">____/____/______</td>
      <td></td>
    </tr>`,
  ).join('');
  return `<section>
  <h2>Descrição do Processo</h2>
  <table class="processo">
    <thead><tr><th></th><th class="marca">Sim</th><th class="marca">Não</th><th>Quantidade</th><th>Responsável</th><th class="data">Data</th><th>Visto</th></tr></thead>
    <tbody>${linhas}</tbody>
  </table>
</section>`;
}

function blocoObservacao(op: OrdemProducao): string {
  return `<section>
  <h2>Observação</h2>
  <div class="caixa observacao">${escaparHtml(op.observacao?.trim() ?? '')}</div>
</section>`;
}

function blocoArte({ arte }: OrdemProducao): string {
  if (!arte) return '';
  const imagem = arte.imagem
    ? `<img src="${dataUrl(arte.imagem)}" alt="Arte do produto">`
    : `<span class="sem-imagem">Arte sem imagem cadastrada</span>`;
  const maquinas = arte.maquinas.length ? arte.maquinas.join(', ') : '—';
  return `<section class="arte">
  <div class="imagem">${imagem}</div>
  <div class="detalhes">
    <p><span class="rotulo">Máquina</span><span class="valor">${escaparHtml(maquinas)}</span></p>
    <p><span class="rotulo">Cor</span><span class="valor">${escaparHtml(arte.cor)}</span></p>
  </div>
</section>`;
}

/** HTML completo (autocontido) da OP, pronto para `page.setContent`. */
export function htmlDaOp(op: OrdemProducao): string {
  return `<!doctype html>
<html lang="pt-BR">
<head><meta charset="utf-8"><title>Ordem de Produção nº ${op.numero}</title><style>${CSS}</style></head>
<body>
${cabecalho(op)}
${blocoCliente(op)}
${blocoDatas(op)}
${blocoItem(op)}
${blocoInsumos(op)}
${blocoProcesso()}
${blocoObservacao(op)}
${blocoArte(op)}
</body>
</html>`;
}
