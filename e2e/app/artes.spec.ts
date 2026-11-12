import { expect, test } from '@playwright/test';

import { USUARIOS } from '../apoio/ambiente.js';
import { apiComo, artesDoProduto, clientePorNome, produtosDoCliente } from '../apoio/api.js';
import { abrirAppLogado, escolherArquivoNoDialogo } from '../apoio/app.js';
import {
  abrirClienteNoApp,
  abrirNovaArteNoApp,
  conferirArteCadastrada,
  novaCorNoApp,
  raizArtes,
} from '../apoio/app-artes.js';
import { arquivoTemporario, PDF_MINIMO, pdfDeTamanho, PNG_1X1 } from '../apoio/arquivos.js';
import { CLIENTES_POR_EMPRESA, nomeDoCliente } from '../apoio/dados.js';

// Artes no app: busca, cadastro com o diálogo de arquivo simulado, Ultra, "Nova cor" e 2.11.

test('admin: busca, cadastra com Ultra e "Nova cor"; "4X4" só seleciona a existente', async () => {
  const { app, janela } = await abrirAppLogado(USUARIOS.admin);
  try {
    const raiz = raizArtes(janela);
    // 2.1 no app: busca sem acento.
    await raiz.getByLabel('Buscar cliente').fill('acai tropical 014');
    await expect(raiz.locator('button.artes-item')).toHaveCount(1);
    await expect(raiz.locator('button.artes-item')).toContainText(nomeDoCliente(13));

    const cliente = nomeDoCliente(24);
    await abrirClienteNoApp(janela, cliente);
    await expect(raiz.getByText('Nenhuma arte cadastrada para este cliente.')).toBeVisible();
    await abrirNovaArteNoApp(janela, 'Rótulo Adesivo');

    // Sem nada marcado: os erros aparecem ao lado dos campos.
    await raiz.getByRole('button', { name: 'Salvar' }).click();
    await expect(raiz.getByRole('alert').filter({ hasText: 'Selecione uma cor.' })).toBeVisible();
    await expect(
      raiz.getByRole('alert').filter({ hasText: 'Selecione ao menos uma máquina.' }),
    ).toBeVisible();
    await expect(
      raiz.getByRole('alert').filter({ hasText: 'Envie ao menos um arquivo.' }),
    ).toBeVisible();

    await escolherArquivoNoDialogo(app, arquivoTemporario('arte-app.pdf', PDF_MINIMO));
    await raiz.getByRole('button', { name: 'Escolher PDF…' }).click();
    await expect(raiz.getByText(/^arte-app\.pdf \(/)).toBeVisible();

    await raiz.getByRole('checkbox', { name: 'Ultra', exact: true }).check();
    const radios = raiz.getByRole('radio');
    const antes = await radios.count();
    await novaCorNoApp(janela, 'Laranja App E2E');
    await expect(raiz.getByRole('radio', { name: 'Laranja App E2E' })).toBeChecked();
    await expect(radios).toHaveCount(antes + 1);
    await novaCorNoApp(janela, '4X4', true);
    await expect(raiz.getByRole('radio', { name: '4x4', exact: true })).toBeChecked();
    await expect(radios).toHaveCount(antes + 1);

    await raiz.getByRole('radio', { name: 'Laranja App E2E' }).check();
    await raiz.getByRole('button', { name: 'Salvar' }).click();
    await conferirArteCadastrada(janela, 'Rótulo Adesivo', '1 arte');
  } finally {
    await app.close();
  }
});

test('lista de clientes pagina de 20 em 20, volta pelo cache e a busca volta à página 1', async () => {
  const { app, janela } = await abrirAppLogado(USUARIOS.finalista);
  try {
    const raiz = raizArtes(janela);
    const itens = raiz.locator('button.artes-item');
    const paginacao = raiz.getByRole('navigation', { name: 'Páginas de clientes' });
    const resumo = paginacao.getByRole('status');
    const carregando = raiz.getByText('Carregando…');

    await expect(itens).toHaveCount(20);
    await expect(resumo).toHaveText(`Página 1 de 3 · ${CLIENTES_POR_EMPRESA} clientes`);
    await expect(paginacao.getByRole('button', { name: '‹ Anterior' })).toBeDisabled();
    const vistos = await itens.allTextContents();

    await paginacao.getByRole('button', { name: 'Página 3' }).click();
    await expect(resumo).toHaveText(/^Página 3 de 3/);
    await expect(carregando).toHaveCount(0);
    await expect(itens).toHaveCount(20);
    await expect(paginacao.getByRole('button', { name: 'Próxima ›' })).toBeDisabled();
    vistos.push(...(await itens.allTextContents()));

    await paginacao.getByRole('button', { name: '‹ Anterior' }).click();
    await expect(resumo).toHaveText(/^Página 2 de 3/);
    await expect(carregando).toHaveCount(0);
    await expect(itens).toHaveCount(20);
    vistos.push(...(await itens.allTextContents()));
    expect(new Set(vistos).size).toBe(CLIENTES_POR_EMPRESA);

    // Página já vista: volta na hora, sem "Carregando…".
    await paginacao.getByRole('button', { name: 'Página 1' }).click();
    await expect(resumo).toHaveText(/^Página 1 de 3/);
    await expect(itens).toHaveText(vistos.slice(0, 20));

    await paginacao.getByRole('button', { name: 'Página 3' }).click();
    await expect(resumo).toHaveText(/^Página 3 de 3/);
    // 10 padarias no seed: uma página só, sem controles.
    await raiz.getByLabel('Buscar cliente').fill('padaria');
    await expect(itens).toHaveCount(10);
    await expect(paginacao).toHaveCount(0);
    await raiz.getByLabel('Buscar cliente').fill('');
    await expect(resumo).toHaveText(`Página 1 de 3 · ${CLIENTES_POR_EMPRESA} clientes`);
  } finally {
    await app.close();
  }
});

test('artes do produto: "Visualizar imagem" abre a imagem; só com PDF mostra "Sem imagem"', async () => {
  // O 8º cliente do seed tem 3 produtos com artes de PDF, de imagem e das duas.
  const nome = nomeDoCliente(7);
  const api = await apiComo(USUARIOS.admin);
  const cliente = await clientePorNome(api, 'aba', nome);
  const produtos = await Promise.all(
    (await produtosDoCliente(api, 'aba', cliente.id)).map(async (produto) => ({
      produto,
      artes: await artesDoProduto(api, 'aba', cliente.id, produto.id),
    })),
  );
  await api.fechar();
  const comImagem = produtos.find(({ artes }) => artes.some((arte) => arte.temImagem));
  const semImagem = produtos.find(({ artes }) => artes.some((arte) => !arte.temImagem));
  if (!comImagem || !semImagem) throw new Error('seed sem as variantes de arte esperadas');

  const { app, janela } = await abrirAppLogado(USUARIOS.finalista);
  try {
    const raiz = raizArtes(janela);
    await abrirClienteNoApp(janela, nome);
    const produto = (nomeProduto: string) =>
      raiz
        .locator('li.produto-com-artes')
        .filter({ has: janela.getByText(nomeProduto, { exact: true }) });

    const itemImagem = produto(comImagem.produto.nome);
    const cabecalho = itemImagem.locator('button.produto-cabecalho');
    await expect(cabecalho).toHaveAttribute('aria-expanded', 'false');
    await cabecalho.click();
    await expect(cabecalho).toHaveAttribute('aria-expanded', 'true');
    const artes = itemImagem.getByRole('list', { name: `Artes de ${comImagem.produto.nome}` });
    await expect(artes.getByRole('listitem')).toHaveCount(comImagem.artes.length);

    const dialogo = janela.getByRole('dialog');
    const imagem = dialogo.getByRole('img');
    const abrir = () => artes.getByRole('button', { name: 'Visualizar imagem' }).first().click();

    await abrir();
    await expect(dialogo).toBeVisible();
    await expect(imagem).toHaveAttribute('src', /^blob:/);
    await expect
      .poll(() => imagem.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth))
      .toBeGreaterThan(0);
    await janela.keyboard.press('Escape');
    await expect(dialogo).toHaveCount(0);

    await abrir();
    await dialogo.getByRole('button', { name: 'Fechar' }).click();
    await expect(dialogo).toHaveCount(0);

    // Clique fora da imagem (no fundo) também fecha.
    await abrir();
    await expect(dialogo).toBeVisible();
    await janela.mouse.click(5, 5);
    await expect(dialogo).toHaveCount(0);

    // Cada arte sem imagem mostra "Sem imagem" no lugar do botão.
    const itemSem = produto(semImagem.produto.nome);
    if (semImagem !== comImagem) await itemSem.locator('button.produto-cabecalho').click();
    const contar = (com: boolean) =>
      semImagem.artes.filter((arte) => arte.temImagem === com).length;
    await expect(itemSem.getByText('Sem imagem', { exact: true })).toHaveCount(contar(false));
    await expect(itemSem.getByRole('button', { name: 'Visualizar imagem' })).toHaveCount(
      contar(true),
    );
  } finally {
    await app.close();
  }
});

test('2.11 extensão trocada é recusada; PDF de 25 MB é enviado pelo app', async () => {
  test.setTimeout(120_000);
  const { app, janela } = await abrirAppLogado(USUARIOS.admin);
  try {
    const raiz = raizArtes(janela);
    await abrirClienteNoApp(janela, nomeDoCliente(26));
    await abrirNovaArteNoApp(janela, 'Copo de Papel');
    // Uma imagem PNG com nome de PDF: o tipo vem dos bytes, não da extensão.
    await escolherArquivoNoDialogo(app, arquivoTemporario('disfarcado.pdf', PNG_1X1));
    await raiz.getByRole('button', { name: 'Escolher PDF…' }).click();
    await expect(raiz.getByText(/^disfarcado\.pdf \(/)).toBeVisible();
    await raiz.getByRole('checkbox', { name: 'Favorit', exact: true }).check();
    await raiz.getByRole('radio', { name: '4x0', exact: true }).check();
    await raiz.getByRole('button', { name: 'Salvar' }).click();
    await expect(
      raiz.getByRole('alert').filter({ hasText: 'O arquivo precisa ser um PDF.' }),
    ).toBeVisible();
    await expect(raiz.locator('.artes-sucesso')).toHaveCount(0);

    // PDF de 25 MB (o limite): o main envia o arquivo inteiro e a API aceita.
    await escolherArquivoNoDialogo(app, arquivoTemporario('limite-app.pdf', pdfDeTamanho(25)));
    await raiz.getByRole('button', { name: 'Escolher PDF…' }).click();
    await expect(raiz.getByText(/^limite-app\.pdf \(/)).toBeVisible();
    await raiz.getByRole('button', { name: 'Salvar' }).click();
    await conferirArteCadastrada(janela, 'Copo de Papel', '1 arte');
  } finally {
    await app.close();
  }
});

test('arte-finalista cadastra com imagem e Ultra junto com outra máquina', async () => {
  const { app, janela } = await abrirAppLogado(USUARIOS.finalista);
  try {
    const raiz = raizArtes(janela);
    await abrirClienteNoApp(janela, nomeDoCliente(27));
    await abrirNovaArteNoApp(janela, 'Envelope Lacrável');
    await escolherArquivoNoDialogo(app, arquivoTemporario('arte-app.png', PNG_1X1));
    await raiz.getByRole('button', { name: 'Escolher Imagem…' }).click();
    // O rótulo do Nome não é ligado ao campo no app: o placeholder identifica.
    await raiz.getByPlaceholder('Padrão').fill('Versão finalista');
    await raiz.getByRole('checkbox', { name: 'Ultra', exact: true }).check();
    await raiz.getByRole('checkbox', { name: 'Rekord', exact: true }).check();
    await raiz.getByRole('radio', { name: '4x4', exact: true }).check();
    await raiz.getByRole('button', { name: 'Salvar' }).click();
    await conferirArteCadastrada(janela, 'Envelope Lacrável', '1 arte');
  } finally {
    await app.close();
  }
});
