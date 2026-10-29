import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

import { eq } from 'drizzle-orm';

import { gerarHash } from '../auth/senha.js';
import { type Banco, criarBanco } from '../db/cliente.js';
import {
  arteMaquinas,
  arquivos,
  artes,
  clientes,
  cores,
  empresas,
  maquinas,
  produtos,
  usuarioEmpresas,
  usuarios,
} from '../db/esquema.js';

export const SENHA_DEV = 'senha-dev-1234';
export const CLIENTES_POR_EMPRESA = 60;

const HOSTS_LOCAIS = new Set(['localhost', '127.0.0.1']);

const PRODUTOS = [
  'Caixa de Pizza',
  'Sacola de Papel',
  'Embalagem para Salgados',
  'Caixa Café da Manhã',
  'Rótulo Adesivo',
  'Envelope Lacrável',
  'Copo de Papel',
  'Bandeja Térmica',
];

const RAMOS = ['Padaria', 'Confeitaria', 'Pizzaria', 'Lanchonete', 'Mercearia', 'Doceria'];
const NOMES = [
  'São João',
  'Pão Quente',
  'Açaí Tropical',
  'Ouro Verde',
  'Estrela do Sul',
  'Beira-Mar',
];

// Cliente de mentira: nome com acento e CNPJ gerado pelo algoritmo, nunca de uma empresa real.
type ClienteFicticio = { razaoSocial: string; nomeFantasia: string | null; cnpj: string };

export const PDF_MINIMO = Buffer.from(
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
    '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 72 72]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n',
  'latin1',
);

export const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==',
  'base64',
);

function digitoVerificador(base: string, pesos: readonly number[]): number {
  const soma = [...base].reduce((total, digito, i) => total + Number(digito) * (pesos[i] ?? 0), 0);
  const resto = soma % 11;
  return resto < 2 ? 0 : 11 - resto;
}

// CNPJ válido de 14 dígitos: raiz de 8 dígitos derivada de `numero`, filial `0001` e os dois verificadores.
export function gerarCnpj(numero: number): string {
  const base = `${String(10_000_000 + numero).padStart(8, '0')}0001`;
  const dv1 = digitoVerificador(base, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const dv2 = digitoVerificador(`${base}${dv1}`, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return `${base}${dv1}${dv2}`;
}

export function gerarCliente(indice: number, deslocamento: number): ClienteFicticio {
  const ramo = RAMOS[indice % RAMOS.length];
  const nome = NOMES[Math.floor(indice / RAMOS.length) % NOMES.length];
  const numero = String(indice + 1).padStart(3, '0');
  return {
    razaoSocial: `${ramo} ${nome} ${numero} Ltda`,
    // Alguns clientes ficam sem nome fantasia, para exercitar o `coalesce` do nome de exibição.
    nomeFantasia: indice % 5 === 0 ? null : `${ramo} ${nome} ${numero}`,
    cnpj: gerarCnpj(deslocamento + indice),
  };
}

// Recusa qualquer banco que não seja o local: o seed grava usuários e dados fictícios.
export function exigirBancoLocal(url: string): void {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    throw new Error('DATABASE_URL inválida.');
  }
  if (!HOSTS_LOCAIS.has(host)) {
    throw new Error(`O semear-dev só roda em localhost ou 127.0.0.1 (host recebido: ${host}).`);
  }
}

const sha256 = (conteudo: Buffer) => createHash('sha256').update(conteudo).digest('hex');

async function gravarArquivo(db: Banco, nomeOriginal: string, tipoMime: string, conteudo: Buffer) {
  const [arquivo] = await db
    .insert(arquivos)
    .values({
      nomeOriginal,
      tipoMime,
      tamanho: conteudo.length,
      sha256: sha256(conteudo),
      conteudo,
    })
    .returning({ id: arquivos.id });
  if (!arquivo) throw new Error('arquivo não gravado');
  return arquivo.id;
}

async function semearUsuarios(db: Banco, empresaIds: string[]): Promise<string> {
  const hash = await gerarHash(SENHA_DEV);
  const dados = [
    { email: 'admin.dev@exemplo.com', nome: 'Admin Fictício', perfil: 'admin' as const },
    {
      email: 'finalista.dev@exemplo.com',
      nome: 'Arte Finalista Fictícia',
      perfil: 'arte_finalista' as const,
    },
  ];
  let adminId = '';
  for (const usuario of dados) {
    const [linha] = await db
      .insert(usuarios)
      .values({ ...usuario, senhaHash: hash })
      .onConflictDoUpdate({ target: usuarios.email, set: { nome: usuario.nome } })
      .returning({ id: usuarios.id });
    if (!linha) throw new Error('usuário não gravado');
    await db
      .insert(usuarioEmpresas)
      .values(empresaIds.map((empresaId) => ({ usuarioId: linha.id, empresaId })))
      .onConflictDoNothing();
    if (usuario.perfil === 'admin') adminId = linha.id;
  }
  return adminId;
}

export type ResumoSemente = { clientes: number; produtos: number; artes: number };

// Idempotente: clientes e produtos repetidos são ignorados; as artes só entram se a empresa ainda não tem nenhuma.
export async function semear(db: Banco): Promise<ResumoSemente> {
  const listaEmpresas = await db.select().from(empresas);
  const todasCores = await db.select().from(cores);
  const todasMaquinas = await db.select().from(maquinas);
  if (listaEmpresas.length === 0 || todasCores.length === 0 || todasMaquinas.length === 0) {
    throw new Error(
      'Aplique as migrações antes (db:migrar:dev): faltam empresas, cores ou máquinas.',
    );
  }

  const adminId = await semearUsuarios(
    db,
    listaEmpresas.map((e) => e.id),
  );
  const resumo: ResumoSemente = { clientes: 0, produtos: 0, artes: 0 };

  for (const [posicao, empresa] of listaEmpresas.entries()) {
    // Faixas de CNPJ separadas por empresa, para o teste manual não confundir os dois lados.
    const deslocamento = (posicao + 1) * 1000;
    const novosClientes = await db
      .insert(clientes)
      .values(
        Array.from({ length: CLIENTES_POR_EMPRESA }, (_, i) => ({
          empresaId: empresa.id,
          ...gerarCliente(i, deslocamento),
        })),
      )
      .onConflictDoNothing()
      .returning({ id: clientes.id });
    const novosProdutos = await db
      .insert(produtos)
      .values(PRODUTOS.map((nome) => ({ empresaId: empresa.id, nome })))
      .onConflictDoNothing()
      .returning({ id: produtos.id });
    resumo.clientes += novosClientes.length;
    resumo.produtos += novosProdutos.length;

    if ((await db.$count(artes, eq(artes.empresaId, empresa.id))) > 0) continue;

    const clientesDaEmpresa = await db
      .select({ id: clientes.id })
      .from(clientes)
      .where(eq(clientes.empresaId, empresa.id))
      .orderBy(clientes.cnpj)
      .limit(15);
    const produtosDaEmpresa = await db
      .select({ id: produtos.id })
      .from(produtos)
      .where(eq(produtos.empresaId, empresa.id))
      .orderBy(produtos.nome);

    for (const [i, cliente] of clientesDaEmpresa.entries()) {
      // 0 a 3 produtos por cliente; os clientes sem arte mostram o placeholder.
      for (let p = 0; p < i % 4; p++) {
        const produto = produtosDaEmpresa[(i + p) % produtosDaEmpresa.length];
        const cor = todasCores[(i + p) % todasCores.length];
        if (!produto || !cor) continue;
        // Alterna entre só PDF, só imagem e os dois.
        const variante = (i + p) % 3;
        const pdfId =
          variante !== 1
            ? await gravarArquivo(db, 'arte.pdf', 'application/pdf', PDF_MINIMO)
            : null;
        const imagemId =
          variante !== 0 ? await gravarArquivo(db, 'arte.png', 'image/png', PNG_1X1) : null;
        const [arte] = await db
          .insert(artes)
          .values({
            empresaId: empresa.id,
            clienteId: cliente.id,
            produtoId: produto.id,
            corId: cor.id,
            pdfId,
            imagemId,
            criadoPor: adminId,
            atualizadoPor: adminId,
          })
          .returning({ id: artes.id });
        if (!arte) throw new Error('arte não gravada');
        const escolhidas = (i + p) % 2 === 0 ? todasMaquinas : todasMaquinas.slice(0, 1);
        await db
          .insert(arteMaquinas)
          .values(escolhidas.map((maquina) => ({ arteId: arte.id, maquinaId: maquina.id })));
        resumo.artes++;
      }
    }
  }
  return resumo;
}

// Execução direta (`npm run semear-dev`): lê só `DATABASE_URL` (nunca `DATABASE_PUBLIC_URL`, que aponta para produção).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('Defina DATABASE_URL (banco local).');
    process.exit(1);
  }
  try {
    exigirBancoLocal(url);
    const { db, fechar } = criarBanco(url);
    try {
      const resumo = await semear(db);
      console.log(
        `Semente aplicada: ${resumo.clientes} clientes, ${resumo.produtos} produtos e ${resumo.artes} artes novos.`,
      );
      console.log(
        `Usuários fictícios: admin.dev@exemplo.com e finalista.dev@exemplo.com (senha: ${SENHA_DEV}).`,
      );
    } finally {
      await fechar();
    }
  } catch (erro) {
    console.error(erro instanceof Error ? erro.message : erro);
    process.exit(1);
  }
}
