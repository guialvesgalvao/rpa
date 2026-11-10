import path from 'node:path';

// Só em desenvolvimento (app não empacotado): a suíte E2E isola o app com estas variáveis.
// No app instalado elas são ignoradas.

/** URL da API: em dev, `RPA_API_URL` do ambiente vale sobre a embutida no build. */
export function escolherUrlDaApi(
  embutida: string,
  env: NodeJS.ProcessEnv,
  empacotado: boolean,
): string {
  const doAmbiente = env.RPA_API_URL?.trim();
  return !empacotado && doAmbiente ? doAmbiente : embutida;
}

/** Pasta de dados (data/, logs/, sessão): em dev, `RPA_DATA_DIR` troca a raiz do projeto. */
export function escolherPastaDeDados(
  padrao: string,
  env: NodeJS.ProcessEnv,
  empacotado: boolean,
): { baseDir: string; isolada: boolean } {
  const doAmbiente = env.RPA_DATA_DIR?.trim();
  if (empacotado || !doAmbiente) return { baseDir: padrao, isolada: false };
  return { baseDir: path.resolve(doAmbiente), isolada: true };
}
