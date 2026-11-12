const SVG = 'http://www.w3.org/2000/svg';

function icone(): { svg: SVGSVGElement; risco: SVGPathElement } {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '18');
  svg.setAttribute('height', '18');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const olho = document.createElementNS(SVG, 'path');
  olho.setAttribute('d', 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z');
  const pupila = document.createElementNS(SVG, 'circle');
  pupila.setAttribute('cx', '12');
  pupila.setAttribute('cy', '12');
  pupila.setAttribute('r', '3');
  const risco = document.createElementNS(SVG, 'path');
  risco.setAttribute('d', 'M4 4l16 16');
  for (const traco of [olho, pupila, risco]) {
    traco.setAttribute('fill', 'none');
    traco.setAttribute('stroke', 'currentColor');
    traco.setAttribute('stroke-width', '2');
    traco.setAttribute('stroke-linecap', 'round');
    traco.setAttribute('stroke-linejoin', 'round');
  }
  svg.append(olho, pupila, risco);
  return { svg, risco };
}

/**
 * Põe o botão "olhinho" no campo de senha: alterna o `type` entre `password` e `text`. Se o campo já está na
 * tela, o contêiner entra no lugar dele. Devolve o contêiner (`.campo-senha`) e uma função que volta a ocultar.
 */
export function comOlho(input: HTMLInputElement): { caixa: HTMLElement; ocultar(): void } {
  const caixa = document.createElement('div');
  caixa.className = 'campo-senha';
  input.replaceWith(caixa);
  const botao = document.createElement('button');
  botao.type = 'button';
  botao.className = 'olho-senha';
  if (input.id) botao.setAttribute('aria-controls', input.id);
  const { svg, risco } = icone();
  botao.append(svg);
  caixa.append(input, botao);

  function mostrar(visivel: boolean) {
    input.type = visivel ? 'text' : 'password';
    const rotulo = visivel ? 'Ocultar senha' : 'Mostrar senha';
    botao.setAttribute('aria-label', rotulo);
    botao.title = rotulo;
    botao.setAttribute('aria-pressed', String(visivel));
    risco.style.display = visivel ? '' : 'none';
  }
  mostrar(false);
  botao.addEventListener('click', () => mostrar(input.type === 'password'));
  return { caixa, ocultar: () => mostrar(false) };
}
