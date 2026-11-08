import { randomUUID } from 'node:crypto';
import type { Readable } from 'node:stream';

// Onde fica o conteúdo dos arquivos. `externo: false` (sem bucket configurado): o conteúdo vai na própria linha
// de `arquivos` (bytea), dentro da transação. `externo: true` (bucket S3): o objeto é gravado antes da
// transação, e a linha guarda só a chave.
export type ArmazemArquivos = {
  readonly externo: boolean;
  gravar(chave: string, dados: Buffer, tipoMime: string): Promise<void>;
  ler(chave: string): Promise<Readable>;
  // Apagar uma chave que não existe não é erro.
  apagar(chave: string): Promise<void>;
};

// Arquivo recebido numa requisição. `chaveObjeto` é preenchida por `comObjetosGravados` quando o armazém é
// externo; aí a linha guarda só a chave (tamanho e sha256 continuam calculados do conteúdo).
export type ArquivoRecebido = {
  nomeOriginal: string;
  tipoMime: string;
  conteudo: Buffer;
  chaveObjeto?: string;
};

export const novaChave = (): string => `arquivos/${randomUUID()}`;

type Registro = { warn(dados: object, mensagem: string): void };

// Apaga objetos cujas linhas já saíram do banco. Falha só vai para o log (com a chave, sem dado do cliente):
// o objeto fica órfão e é limpo à mão.
export async function apagarObjetos(
  armazem: ArmazemArquivos,
  chaves: readonly (string | null)[],
  log?: Registro,
): Promise<void> {
  if (!armazem.externo) return;
  for (const chave of chaves) {
    if (!chave) continue;
    try {
      await armazem.apagar(chave);
    } catch (erro) {
      log?.warn({ chave, erro: (erro as Error).message }, 'Objeto órfão no bucket');
    }
  }
}

// Grava os arquivos no bucket antes de `executar` (a transação) e, se ela falhar, apaga o que gravou. Com o
// armazém no banco, só executa.
export async function comObjetosGravados<T>(
  armazem: ArmazemArquivos,
  arquivos: readonly (ArquivoRecebido | undefined)[],
  executar: () => Promise<T>,
  log?: Registro,
): Promise<T> {
  if (!armazem.externo) return executar();
  const gravadas: string[] = [];
  try {
    for (const arquivo of arquivos) {
      if (!arquivo) continue;
      const chave = novaChave();
      await armazem.gravar(chave, arquivo.conteudo, arquivo.tipoMime);
      arquivo.chaveObjeto = chave;
      gravadas.push(chave);
    }
    return await executar();
  } catch (erro) {
    await apagarObjetos(armazem, gravadas, log);
    for (const arquivo of arquivos) if (arquivo) delete arquivo.chaveObjeto;
    throw erro;
  }
}
