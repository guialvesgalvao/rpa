/** Imagem embutida no PDF (vira data URL). Só PNG, JPEG, WebP ou GIF. */
export type ImagemOp = { bytes: Uint8Array; mime: string };

export type ArteDaOp = {
  /** Sem imagem (arte cadastrada só com PDF), o bloco mostra um aviso no lugar dela. */
  imagem?: ImagemOp;
  maquinas: string[];
  cor: string;
};

export type ItemDaOp = { descricao: string; codigo: string; unidade: string; quantidade: number };

export type InsumoDaOp = { nome: string; unidade: string; quantidadePorUnidade: number };

/** Marca nas colunas Sim/Não da "Descrição do Processo". */
export type MarcaProcesso = 'sim' | 'nao';

/** Linha da "Descrição do Processo"; campo ausente sai em branco para preencher à mão. */
export type LinhaProcessoDaOp = {
  aplica?: MarcaProcesso;
  quantidade?: string;
  responsavel?: string;
  data?: Date;
};

/** Tudo o que o PDF de uma OP mostra: uma OP por produto do pedido. */
export type OrdemProducao = {
  numero: number;
  /** Data de emissão da OP; também é a "Data início de produção", como na OP do Bling. */
  data: Date;
  /** Nome da empresa no cabeçalho; aparece quando não há `logo`. */
  empresa: string;
  logo?: ImagemOp;
  cliente: { nome: string; fantasia?: string };
  numeroPedido: string;
  /** Previsão inicial = data da venda. */
  previsaoInicial: Date;
  /** Previsão final = data prevista do pedido; ausente, sai em branco. */
  previsaoFinal?: Date;
  /** "Data entrega de produção", do pré-preenchimento; ausente, sai em branco. */
  dataEntrega?: Date;
  item: ItemDaOp;
  insumos: InsumoDaOp[];
  /** Uma linha por passo de `PASSOS_PROCESSO`; ausente (ou linha ausente), sai em branco. */
  processo?: LinhaProcessoDaOp[];
  observacao?: string;
  /** Ausente: o PDF sai sem o bloco de arte. */
  arte?: ArteDaOp;
};
