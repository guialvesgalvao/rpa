import { readFile } from 'node:fs/promises';

import { expect, test } from '@playwright/test';

import { ESTADO_SITE, USUARIOS } from '../apoio/ambiente.js';
import { apiComo, artesDoProduto, clientePorNome, produtosDoCliente } from '../apoio/api.js';
import {
  CLIENTES_POR_EMPRESA,
  PRIMEIRO_SEM_ARTE,
  mascararCnpj,
  nomeDoCliente,
} from '../apoio/dados.js';

// Itens 2.1 a 2.5 de testes-manuais-pendentes (lista e página do cliente), com os dois perfis.
for (const perfil of ['admin', 'finalista'] as const) {
  test.describe(`clientes no site (${perfil})`, () => {
    test.use({ storageState: ESTADO_SITE[perfil] });

    test('2.1 busca por nome sem acento acha o cliente com acento', async ({ page }) => {
      const nome = nomeDoCliente(13); // "Confeitaria Açaí Tropical 014"
      await page.goto('/aba/artes');
      await page.getByLabel('Buscar cliente').fill('acai tropical 014');
      await expect(page.locator('ul.lista li')).toHaveCount(1);
      await expect(page.getByRole('link', { name: nome })).toBeVisible();
    });

    test('2.2 busca por CNPJ com máscara acha o mesmo cliente', async ({ page }) => {
      const nome = nomeDoCliente(13);
      const api = await apiComo(USUARIOS.admin);
      const cliente = await clientePorNome(api, 'aba', nome);
      await api.fechar();
      await page.goto('/aba/artes');
      await page.getByLabel('Buscar cliente').fill(mascararCnpj(cliente.cnpj));
      await expect(page.locator('ul.lista li')).toHaveCount(1);
      await expect(page.getByRole('link', { name: nome })).toBeVisible();
    });

    test('2.3 pagina de 20 em 20 com o total, sem repetição, e volta usa o cache', async ({
      page,
    }) => {
      // Só as requisições concluídas: em dev, o Strict Mode do React roda o efeito duas vezes e aborta a
      // primeira carga.
      const requisicoes: string[] = [];
      page.on('requestfinished', (requisicao) => {
        if (/\/api\/v1\/empresas\/aba\/clientes\?/.test(requisicao.url())) {
          requisicoes.push(requisicao.url());
        }
      });
      await page.goto('/aba/artes');
      const itens = page.locator('ul.lista li');
      const links = page.locator('ul.lista li a');
      const paginacao = page.getByRole('navigation', { name: 'Páginas de clientes' });
      const carregando = page.getByText('Carregando…');
      const hrefs = () => links.evaluateAll((todos) => todos.map((l) => l.getAttribute('href')));

      await expect(itens).toHaveCount(20);
      await expect(paginacao.getByRole('status')).toHaveText(
        `Página 1 de 3 · ${CLIENTES_POR_EMPRESA} clientes`,
      );
      await expect(paginacao.getByRole('button', { name: 'Página 1' })).toHaveAttribute(
        'aria-current',
        'page',
      );
      await expect(paginacao.getByRole('button', { name: '‹ Anterior' })).toBeDisabled();
      const vistos = await hrefs();

      await paginacao.getByRole('button', { name: 'Página 3' }).click();
      await expect(paginacao.getByRole('status')).toHaveText(/^Página 3 de 3/);
      await expect(carregando).toHaveCount(0);
      await expect(itens).toHaveCount(20);
      await expect(paginacao.getByRole('button', { name: 'Próxima ›' })).toBeDisabled();
      vistos.push(...(await hrefs()));

      await paginacao.getByRole('button', { name: '‹ Anterior' }).click();
      await expect(paginacao.getByRole('status')).toHaveText(/^Página 2 de 3/);
      await expect(carregando).toHaveCount(0);
      await expect(itens).toHaveCount(20);
      vistos.push(...(await hrefs()));
      expect(new Set(vistos).size).toBe(CLIENTES_POR_EMPRESA);
      expect(requisicoes).toHaveLength(3);
      expect(requisicoes.every((url) => /[?&]pagina=\d/.test(url))).toBe(true);

      // Página já vista: volta sem nova requisição.
      await paginacao.getByRole('button', { name: 'Página 1' }).click();
      await expect(paginacao.getByRole('status')).toHaveText(/^Página 1 de 3/);
      await expect(itens).toHaveCount(20);
      expect(await hrefs()).toEqual(vistos.slice(0, 20));
      expect(requisicoes).toHaveLength(3);
      await expect(page.locator('main').getByRole('alert')).toHaveCount(0);
    });

    test('2.3b busca nova volta à página 1', async ({ page }) => {
      await page.goto('/aba/artes');
      const itens = page.locator('ul.lista li');
      const paginacao = page.getByRole('navigation', { name: 'Páginas de clientes' });
      await expect(itens).toHaveCount(20);
      await paginacao.getByRole('button', { name: 'Página 3' }).click();
      await expect(paginacao.getByRole('status')).toHaveText(/^Página 3 de 3/);

      // 10 padarias no seed: uma página só, sem controles.
      await page.getByLabel('Buscar cliente').fill('padaria');
      await expect(itens).toHaveCount(10);
      await expect(paginacao).toHaveCount(0);

      await page.getByLabel('Buscar cliente').fill('');
      await expect(paginacao.getByRole('status')).toHaveText(
        `Página 1 de 3 · ${CLIENTES_POR_EMPRESA} clientes`,
      );
      await expect(itens).toHaveCount(20);
    });

    test('2.4 cliente com artes mostra o contador por produto', async ({ page }) => {
      // O 4º cliente do seed tem 3 produtos com arte.
      const api = await apiComo(USUARIOS.admin);
      const cliente = await clientePorNome(api, 'aba', nomeDoCliente(3));
      await api.fechar();
      await page.goto(`/aba/artes/clientes/${cliente.id}`);
      const contadores = page.locator('ul.lista li .status');
      await expect(contadores).toHaveCount(3);
      for (const texto of await contadores.allTextContents()) {
        expect(texto).toMatch(/^(1 arte|\d+ artes)$/);
      }
    });

    test('2.6 artes do produto: "Visualizar imagem" abre a imagem; só com PDF mostra "Sem imagem"', async ({
      page,
    }) => {
      // O 12º cliente do seed tem 3 produtos com artes de PDF, de imagem e das duas.
      const api = await apiComo(USUARIOS.admin);
      const cliente = await clientePorNome(api, 'aba', nomeDoCliente(11));
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

      await page.goto(`/aba/artes/clientes/${cliente.id}`);
      const produto = (nome: string) =>
        page.locator('li.produto-com-artes').filter({ has: page.getByText(nome, { exact: true }) });

      // Fechado, o produto não mostra as artes; abrir busca e lista.
      const itemImagem = produto(comImagem.produto.nome);
      const cabecalho = itemImagem.locator('button.produto-cabecalho');
      await expect(cabecalho).toHaveAttribute('aria-expanded', 'false');
      await cabecalho.click();
      await expect(cabecalho).toHaveAttribute('aria-expanded', 'true');
      const artes = itemImagem.getByRole('list', { name: `Artes de ${comImagem.produto.nome}` });
      await expect(artes.getByRole('listitem')).toHaveCount(comImagem.artes.length);

      const dialogo = page.getByRole('dialog');
      const imagem = dialogo.getByRole('img');
      const abrir = () => artes.getByRole('button', { name: 'Visualizar imagem' }).first().click();

      await abrir();
      await expect(dialogo).toBeVisible();
      await expect(imagem).toHaveAttribute('alt', /^Arte /);
      await expect
        .poll(() => imagem.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth))
        .toBeGreaterThan(0);
      await page.keyboard.press('Escape');
      await expect(dialogo).toHaveCount(0);

      await abrir();
      await dialogo.getByRole('button', { name: 'Fechar' }).click();
      await expect(dialogo).toHaveCount(0);

      // Clique fora da imagem (no fundo) também fecha.
      await abrir();
      await expect(dialogo).toBeVisible();
      await page.mouse.click(5, 5);
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
    });

    test('2.7 artes do produto: "Baixar arquivo PDF" baixa o PDF; só com imagem mostra "Sem PDF"', async ({
      page,
    }) => {
      // O 12º cliente do seed tem artes só com PDF, só com imagem e com os dois.
      const api = await apiComo(USUARIOS.admin);
      const cliente = await clientePorNome(api, 'aba', nomeDoCliente(11));
      const produtos = await Promise.all(
        (await produtosDoCliente(api, 'aba', cliente.id)).map(async (produto) => ({
          produto,
          artes: await artesDoProduto(api, 'aba', cliente.id, produto.id),
        })),
      );
      await api.fechar();
      const comPdf = produtos.find(({ artes }) => artes.some((arte) => arte.temPdf));
      const semPdf = produtos.find(({ artes }) => artes.some((arte) => !arte.temPdf));
      if (!comPdf || !semPdf) throw new Error('seed sem as variantes de arte esperadas');

      await page.goto(`/aba/artes/clientes/${cliente.id}`);
      const produto = (nome: string) =>
        page.locator('li.produto-com-artes').filter({ has: page.getByText(nome, { exact: true }) });

      const itemPdf = produto(comPdf.produto.nome);
      await itemPdf.locator('button.produto-cabecalho').click();
      const artes = itemPdf.getByRole('list', { name: `Artes de ${comPdf.produto.nome}` });
      const [download] = await Promise.all([
        page.waitForEvent('download'),
        artes.getByRole('link', { name: 'Baixar arquivo PDF' }).first().click(),
      ]);
      expect(download.suggestedFilename().toLowerCase()).toMatch(/\.pdf$/);
      const caminho = await download.path();
      expect((await readFile(caminho)).subarray(0, 4).toString('latin1')).toBe('%PDF');

      // Cada arte sem PDF mostra "Sem PDF" no lugar do link.
      const itemSem = produto(semPdf.produto.nome);
      if (semPdf !== comPdf) await itemSem.locator('button.produto-cabecalho').click();
      const contar = (com: boolean) => semPdf.artes.filter((arte) => arte.temPdf === com).length;
      await expect(itemSem.getByText('Sem PDF', { exact: true })).toHaveCount(contar(false));
      await expect(itemSem.getByRole('link', { name: 'Baixar arquivo PDF' })).toHaveCount(
        contar(true),
      );
    });

    test('2.5 cliente sem artes mostra o placeholder', async ({ page }) => {
      const api = await apiComo(USUARIOS.admin);
      const cliente = await clientePorNome(api, 'aba', nomeDoCliente(PRIMEIRO_SEM_ARTE + 40));
      await api.fechar();
      await page.goto(`/aba/artes/clientes/${cliente.id}`);
      await expect(page.getByText('Nenhuma arte cadastrada para este cliente.')).toBeVisible();
    });
  });
}
