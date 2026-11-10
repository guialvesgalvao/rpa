import { expect, test } from '@playwright/test';

import { ESTADO_SITE, USUARIOS } from '../apoio/ambiente.js';
import { apiComo, artesDoProduto, produtosDoCliente } from '../apoio/api.js';
import { arquivoTemporario, PDF_MINIMO, pdfDeTamanho, PNG_1X1 } from '../apoio/arquivos.js';
import { abrirNovaArte, clienteDoSeed, preencherArte, salvarArte } from '../apoio/site-artes.js';

// Itens 2.6 a 2.10 de testes-manuais-pendentes, Ultra e "Nova cor" (plano ultra-cores-observacao-op).
// Cada cenário usa um cliente do seed que ainda não tem arte (índices 16 em diante).

const pdf = () => arquivoTemporario('arte.pdf', PDF_MINIMO);
const png = () => arquivoTemporario('arte.png', PNG_1X1);

test.describe('cadastro de arte no site (admin)', () => {
  test.use({ storageState: ESTADO_SITE.admin });
  test.describe.configure({ mode: 'serial' });

  const produto = 'Caixa de Pizza';

  test('2.7 sem arquivo, máquina e cor mostra o erro ao lado de cada campo', async ({ page }) => {
    const cliente = await clienteDoSeed('aba', 16);
    await abrirNovaArte(page, 'aba', cliente.id, produto);
    await page.getByRole('button', { name: 'Salvar' }).click();
    const erros = page.locator('main').getByRole('alert');
    await expect(erros.filter({ hasText: 'Selecione uma cor.' })).toBeVisible();
    await expect(erros.filter({ hasText: 'Selecione ao menos uma máquina.' })).toBeVisible();
    await expect(erros.filter({ hasText: 'Envie ao menos um arquivo.' })).toBeVisible();
    await expect(page).toHaveURL(/\/artes\/nova\?/);
  });

  test('2.6 + 2.8 só PDF, nome em branco e só a Ultra: salva como "Padrão"', async ({ page }) => {
    const cliente = await clienteDoSeed('aba', 17);
    await abrirNovaArte(page, 'aba', cliente.id, produto);
    await preencherArte(page, { cor: '4x0', maquinas: ['Ultra'], pdf: pdf() });
    await salvarArte(page, produto, '1 arte');

    const api = await apiComo(USUARIOS.admin);
    const [comArte] = await produtosDoCliente(api, 'aba', cliente.id);
    const artes = await artesDoProduto(api, 'aba', cliente.id, comArte!.id);
    await api.fechar();
    expect(artes).toHaveLength(1);
    expect(artes[0]).toMatchObject({ nome: 'Padrão', temPdf: true, temImagem: false });
    expect(artes[0]!.maquinas.map((m) => m.nome)).toEqual(['Ultra']);
  });

  test('2.6 só imagem e depois os dois arquivos: o contador sobe; Ultra junto com outras', async ({
    page,
  }) => {
    const cliente = await clienteDoSeed('aba', 18);
    await abrirNovaArte(page, 'aba', cliente.id, produto);
    await preencherArte(page, {
      nome: 'Só imagem',
      cor: '4x4',
      maquinas: ['Ultra', 'Favorit'],
      imagem: png(),
    });
    await salvarArte(page, produto, '1 arte');

    await abrirNovaArte(page, 'aba', cliente.id, produto);
    await preencherArte(page, {
      nome: 'Completa',
      cor: '4x0',
      maquinas: ['Favorit', 'Rekord', 'Ultra'],
      pdf: pdf(),
      imagem: png(),
    });
    await salvarArte(page, produto, '2 artes');

    const api = await apiComo(USUARIOS.admin);
    const [comArte] = await produtosDoCliente(api, 'aba', cliente.id);
    const artes = await artesDoProduto(api, 'aba', cliente.id, comArte!.id);
    await api.fechar();
    const porNome = Object.fromEntries(artes.map((a) => [a.nome, a]));
    expect(porNome['Só imagem']).toMatchObject({ temPdf: false, temImagem: true });
    expect(porNome['Completa']).toMatchObject({ temPdf: true, temImagem: true });
    expect(porNome['Só imagem']!.maquinas.map((m) => m.nome).sort()).toEqual(['Favorit', 'Ultra']);
    expect(porNome['Completa']!.maquinas).toHaveLength(3);
  });

  test('2.9 nome repetido no mesmo produto dá erro no campo Nome', async ({ page }) => {
    const cliente = await clienteDoSeed('aba', 18);
    await abrirNovaArte(page, 'aba', cliente.id, produto);
    await preencherArte(page, { nome: 'Completa', cor: '4x0', maquinas: ['Rekord'], pdf: pdf() });
    await page.getByRole('button', { name: 'Salvar' }).click();
    await expect(page.locator('main').getByRole('alert')).toHaveText(
      "Já existe uma arte 'Completa' para este produto",
    );
    await expect(page).toHaveURL(/\/artes\/nova\?/);
  });

  test('2.10 PDF de 25 MB passa pelo proxy; acima de 25 MB é recusado', async ({ page }) => {
    test.setTimeout(120_000);
    const cliente = await clienteDoSeed('aba', 19);
    await abrirNovaArte(page, 'aba', cliente.id, produto);
    await preencherArte(page, {
      cor: '4x0',
      maquinas: ['Favorit'],
      pdf: arquivoTemporario('grande.pdf', pdfDeTamanho(25.5)),
    });
    await page.getByRole('button', { name: 'Salvar' }).click();
    await expect(page.locator('main').getByRole('alert')).toHaveText('O arquivo passa de 25 MB.');

    await page
      .getByLabel('PDF', { exact: true })
      .setInputFiles(arquivoTemporario('limite.pdf', pdfDeTamanho(25)));
    const salvar = page.getByRole('button', { name: /^Salvar/ });
    await salvar.click();
    // Durante o envio o botão fica desabilitado ("Salvando…").
    await expect(page.getByRole('button', { name: 'Salvando…' })).toBeDisabled();
    await expect(page.getByRole('status')).toHaveText('Arte cadastrada', { timeout: 90_000 });
  });

  test('"Nova cor" cria e seleciona; "4X4" só seleciona a 4x4 existente', async ({ page }) => {
    const cliente = await clienteDoSeed('aba', 20);
    await abrirNovaArte(page, 'aba', cliente.id, produto);
    const radios = page.getByRole('radio');
    const antes = await radios.count();

    await page.getByRole('button', { name: '+ Nova cor' }).click();
    await page.getByLabel('Nome da nova cor').fill('Verde Limão E2E');
    await page.getByRole('button', { name: 'Adicionar' }).click();
    await expect(page.getByRole('radio', { name: 'Verde Limão E2E' })).toBeChecked();
    await expect(radios).toHaveCount(antes + 1);

    await page.getByRole('button', { name: '+ Nova cor' }).click();
    await page.getByLabel('Nome da nova cor').fill('4X4');
    await page.getByLabel('Nome da nova cor').press('Enter');
    await expect(page.getByRole('radio', { name: '4x4', exact: true })).toBeChecked();
    await expect(radios).toHaveCount(antes + 1);

    // A cor nova serve para salvar a arte.
    await page.getByRole('radio', { name: 'Verde Limão E2E' }).check();
    await preencherArte(page, { cor: 'Verde Limão E2E', maquinas: ['Ultra'], pdf: pdf() });
    await salvarArte(page, produto, '1 arte');
  });
});

test.describe('cadastro de arte no site (arte-finalista)', () => {
  test.use({ storageState: ESTADO_SITE.finalista });

  test('2.6 arte-finalista cadastra e cria cor', async ({ page }) => {
    const cliente = await clienteDoSeed('aba', 21);
    await abrirNovaArte(page, 'aba', cliente.id, 'Sacola de Papel');
    await page.getByRole('button', { name: '+ Nova cor' }).click();
    await page.getByLabel('Nome da nova cor').fill('Azul Finalista E2E');
    await page.getByRole('button', { name: 'Adicionar' }).click();
    await expect(page.getByRole('radio', { name: 'Azul Finalista E2E' })).toBeChecked();
    await preencherArte(page, {
      cor: 'Azul Finalista E2E',
      maquinas: ['Rekord', 'Ultra'],
      imagem: png(),
    });
    await salvarArte(page, 'Sacola de Papel', '1 arte');
  });
});
