import { z } from 'zod';

import { type PedidoSelecao, TODOS_DOCS } from '../processes/bling/selecao.js';
import {
  dataIsoValida,
  LIMITES_PREENCHIMENTO,
  normalizarPreenchimento,
} from '../processes/op/preenchimento.js';
import { PASSOS_PROCESSO } from '../processes/op/template.js';
import type { ConsultaTarefasApp, ItemParaGerarOp } from './api.js';
import {
  ANEXOS_POR_COMENTARIO,
  COMENTARIO_TAREFA_MAX,
  ESCOPOS_TAREFAS,
  EsquemaNovoUsuario,
  validarNovaCor,
  EsquemaStatusTarefa,
  type NovoUsuario,
  SENHA_MAXIMA,
  SENHA_MINIMA,
  type StatusTarefa,
} from './plataforma/contratos.js';

const schema = z.array(
  z.object({
    numero: z.string().regex(/^\d+$/, 'Número de pedido inválido'),
    docs: z.array(z.enum(TODOS_DOCS)),
  }),
);

/**
 * Valida a seleção que chega da janela pelo IPC. Pedido sem documento fica de fora; documento
 * repetido conta uma vez. Lança erro se o formato for inválido ou se não sobrar nenhum pedido.
 */
export function validarSelecao(input: unknown): PedidoSelecao[] {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    throw new Error(`Seleção inválida: ${parsed.error.issues[0]?.message ?? 'formato inesperado'}`);
  }
  const selecao = parsed.data
    .map(({ numero, docs }) => ({ numero, docs: [...new Set(docs)] }))
    .filter(({ docs }) => docs.length > 0);
  if (!selecao.length) throw new Error('Selecione ao menos um pedido com um documento.');
  return selecao;
}

const slugSchema = z.string().trim().min(1).max(100);

/** Valida o slug da empresa que chega da janela pelo IPC; a checagem contra o perfil é do main. */
export function validarSlug(input: unknown): string {
  const parsed = slugSchema.safeParse(input);
  if (!parsed.success) throw new Error('Empresa inválida.');
  return parsed.data;
}

const loginSchema = z.object({
  email: z.string().trim().min(1).max(200),
  senha: z.string().min(1).max(200),
});

/** Valida o login que chega da janela pelo IPC (e-mail e senha de até 200 caracteres). */
export function validarLogin(input: unknown): { email: string; senha: string } {
  const parsed = loginSchema.safeParse(input);
  if (!parsed.success) throw new Error('Informe o e-mail e a senha.');
  return parsed.data;
}

const idSchema = z.uuid();

/** Valida um id (cliente, arquivo escolhido) que chega da janela pelo IPC. */
export function validarId(input: unknown): string {
  const parsed = idSchema.safeParse(input);
  if (!parsed.success) throw new Error('Identificador inválido.');
  return parsed.data;
}

const consultaClientesSchema = z.object({
  busca: z.string().max(100).optional(),
  cursor: z.string().max(512).nullish(),
});

/** Valida a busca e o cursor (opaco) da lista de clientes; a API valida o cursor em si. */
export function validarConsultaClientes(input: unknown): { busca?: string; cursor?: string } {
  const parsed = consultaClientesSchema.safeParse(input);
  if (!parsed.success) throw new Error('Busca inválida.');
  const { busca, cursor } = parsed.data;
  return { busca: busca?.trim() || undefined, cursor: cursor || undefined };
}

/** Valida o tipo de arquivo que a janela pede para escolher. */
export function validarTipoArquivo(input: unknown): 'pdf' | 'imagem' {
  const parsed = z.enum(['pdf', 'imagem']).safeParse(input);
  if (!parsed.success) throw new Error('Tipo de arquivo inválido.');
  return parsed.data;
}

const cnpjSchema = z
  .string()
  .max(30)
  .transform((cnpj) => cnpj.replace(/\D/g, ''))
  .pipe(z.string().length(14));

/** Valida o CNPJ que chega da janela (com ou sem máscara) e devolve só os 14 dígitos. */
export function validarCnpj(input: unknown): string {
  const parsed = cnpjSchema.safeParse(input);
  if (!parsed.success) throw new Error('CNPJ inválido.');
  return parsed.data;
}

const itemOpSchema = z.object({
  clienteId: z.uuid(),
  codigo: z.string().trim().min(1).max(100),
});

/** Valida o item da OP (cliente do banco e código do produto no Bling) que chega pelo IPC. */
export function validarItemOp(input: unknown): { clienteId: string; codigo: string } {
  const parsed = itemOpSchema.safeParse(input);
  if (!parsed.success) throw new Error('Item da OP inválido.');
  return parsed.data;
}

/** Mesmo teto do intervalo De/Até da Fatura. */
export const MAX_PEDIDOS_OP = 200;

const numerosOpSchema = z
  .array(z.string().regex(/^\d{1,12}$/))
  .min(1)
  .max(MAX_PEDIDOS_OP);

/** Valida os números de pedido da OP; repetidos contam uma vez, na ordem em que vieram. */
export function validarNumerosOp(input: unknown): string[] {
  const parsed = numerosOpSchema.safeParse(input);
  if (!parsed.success) throw new Error('Números de pedido inválidos.');
  return [...new Set(parsed.data)];
}

const dataIsoSchema = z.string().refine(dataIsoValida);

const linhaProcessoSchema = z.object({
  aplica: z.enum(['sim', 'nao']).optional(),
  quantidade: z.string().max(LIMITES_PREENCHIMENTO.quantidade).optional(),
  responsavel: z.string().max(LIMITES_PREENCHIMENTO.responsavel).optional(),
  data: z.union([z.literal(''), dataIsoSchema]).optional(),
});

const preenchimentoSchema = z.object({
  dataEntrega: z.union([z.literal(''), dataIsoSchema]).optional(),
  processo: z.array(linhaProcessoSchema).length(PASSOS_PROCESSO.length).optional(),
  observacao: z.string().max(LIMITES_PREENCHIMENTO.observacao).optional(),
});

const itensOpSchema = z
  .array(
    z.object({
      numero: z.string().regex(/^\d{1,12}$/),
      indice: z.number().int().min(0).max(1000),
      arteId: z.uuid().optional(),
      preenchimento: preenchimentoSchema.optional(),
    }),
  )
  .max(1000);

/**
 * Valida os produtos marcados para gerar a OP; item repetido conta uma vez. O pré-preenchimento
 * volta normalizado (sem espaços nem campos vazios) e some se não tiver nenhum dado.
 */
export function validarItensOp(input: unknown): ItemParaGerarOp[] {
  const parsed = itensOpSchema.safeParse(input);
  if (!parsed.success) throw new Error('Seleção de produtos inválida.');
  const vistos = new Set<string>();
  const itens: ItemParaGerarOp[] = [];
  for (const { preenchimento, ...item } of parsed.data) {
    const chave = `${item.numero}:${item.indice}`;
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    const normalizado = normalizarPreenchimento(preenchimento);
    itens.push(normalizado ? { ...item, preenchimento: normalizado } : item);
  }
  if (!itens.length) throw new Error('Marque ao menos um produto.');
  return itens;
}

const cadastroSchema = z.object({
  clienteId: z.uuid(),
  // Ids vazios passam: `validarNovaArte` devolve "Selecione um produto/cor" ao lado do campo.
  produtoId: z.string().max(100),
  nome: z.string().max(500).optional(),
  corId: z.string().max(100),
  maquinaIds: z.array(z.string().max(100)).max(20),
  pdfId: z.uuid().optional(),
  imagemId: z.uuid().optional(),
});

export type CadastroEntrada = z.infer<typeof cadastroSchema>;

/** Valida o cadastro de arte que chega da janela pelo IPC; os arquivos vêm como ids de `escolherArquivo`. */
export function validarCadastro(input: unknown): CadastroEntrada {
  const parsed = cadastroSchema.safeParse(input);
  if (!parsed.success) throw new Error('Dados da arte inválidos.');
  return parsed.data;
}

const conclusaoSchema = cadastroSchema.omit({ clienteId: true }).extend({ tarefaId: z.uuid() });

export type ConclusaoEntrada = z.infer<typeof conclusaoSchema>;

/** Valida a conclusão de tarefa: os mesmos campos do cadastro de arte, sem o cliente (é o da tarefa). */
export function validarConclusao(input: unknown): ConclusaoEntrada {
  const parsed = conclusaoSchema.safeParse(input);
  if (!parsed.success) throw new Error('Dados da arte inválidos.');
  return parsed.data;
}

const novaTarefaSchema = z.object({ clienteId: z.uuid(), produtoId: z.uuid() });

export function validarNovaTarefa(input: unknown): { clienteId: string; produtoId: string } {
  const parsed = novaTarefaSchema.safeParse(input);
  if (!parsed.success) throw new Error('Cliente ou produto inválido.');
  return parsed.data;
}

const consultaTarefasSchema = z.object({
  escopo: z.enum(ESCOPOS_TAREFAS),
  status: EsquemaStatusTarefa.optional(),
});

export function validarConsultaTarefas(input: unknown): ConsultaTarefasApp {
  const parsed = consultaTarefasSchema.safeParse(input);
  if (!parsed.success) throw new Error('Filtro de tarefas inválido.');
  return parsed.data;
}

const mudancaStatusSchema = z.object({ id: z.uuid(), status: EsquemaStatusTarefa });

export function validarMudancaStatus(input: unknown): { id: string; status: StatusTarefa } {
  const parsed = mudancaStatusSchema.safeParse(input);
  if (!parsed.success) throw new Error('Status inválido.');
  return parsed.data;
}

const comentarioSchema = z.object({
  id: z.uuid(),
  texto: z.string().trim().max(COMENTARIO_TAREFA_MAX),
  anexoIds: z.array(z.uuid()).max(ANEXOS_POR_COMENTARIO).optional(),
});

/** Texto (até o limite) ou anexos (até 5 ids escolhidos no diálogo); os dois vazios é erro. */
export function validarComentario(input: unknown): {
  id: string;
  texto: string;
  anexoIds: string[];
} {
  const parsed = comentarioSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(
      `Escreva um comentário de até ${COMENTARIO_TAREFA_MAX} caracteres e anexe no máximo ${ANEXOS_POR_COMENTARIO} arquivos.`,
    );
  }
  const anexoIds = parsed.data.anexoIds ?? [];
  if (!parsed.data.texto && anexoIds.length === 0) {
    throw new Error('Escreva o comentário ou anexe um arquivo.');
  }
  return { id: parsed.data.id, texto: parsed.data.texto, anexoIds };
}

const anexoParaBaixarSchema = z.object({
  tarefaId: z.uuid(),
  comentarioId: z.uuid(),
  anexoId: z.uuid(),
  nome: z.string().min(1).max(500),
});

export function validarAnexoParaBaixar(input: unknown): z.infer<typeof anexoParaBaixarSchema> {
  const parsed = anexoParaBaixarSchema.safeParse(input);
  if (!parsed.success) throw new Error('Anexo inválido.');
  return parsed.data;
}

/** Nome da cor nova (mesmas regras do site e da API), sem os espaços em volta. */
export function validarNomeCor(input: unknown): string {
  if (typeof input !== 'string') throw new Error('Informe o nome da cor.');
  const erro = validarNovaCor(input);
  if (erro) throw new Error(erro);
  return input.trim();
}

/** Novo usuário da aba Usuários: a mensagem do primeiro problema, pronta para a tela. */
export function validarNovoUsuario(input: unknown): NovoUsuario {
  const parsed = EsquemaNovoUsuario.safeParse(input);
  if (!parsed.success)
    throw new Error(parsed.error.issues[0]?.message ?? 'Dados do usuário inválidos.');
  return parsed.data;
}

/** Responsável automático: um id ou `null` (sem escolha). */
export function validarResponsavelAutomatico(input: unknown): string | null {
  const parsed = z.uuid().nullable().safeParse(input);
  if (!parsed.success) throw new Error('Responsável inválido.');
  return parsed.data;
}

const trocaSenhaSchema = z.object({
  senhaAtual: z.string().min(1, 'Informe a senha atual.').max(SENHA_MAXIMA),
  novaSenha: z
    .string()
    .min(SENHA_MINIMA, `A nova senha precisa de ao menos ${SENHA_MINIMA} caracteres.`)
    .max(SENHA_MAXIMA),
});

export function validarTrocaSenha(input: unknown): { senhaAtual: string; novaSenha: string } {
  const parsed = trocaSenhaSchema.safeParse(input);
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? 'Senha inválida.');
  return parsed.data;
}
