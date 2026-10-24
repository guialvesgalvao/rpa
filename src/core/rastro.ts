/** Um passo do passo a passo mostrado ao usuário ("Busquei o pedido…", "Cliquei em…"). */
export type Passo = { texto: string; status: 'ok' | 'erro'; erro?: string };

export type Rastro = {
  passos: Passo[];
  /** Executa `fn` e registra o passo como ok, ou como erro (com a 1ª linha da mensagem) e relança. */
  etapa<T>(texto: string, fn: () => Promise<T>): Promise<T>;
};

/** 1ª linha da mensagem do erro (as do Playwright trazem o log de chamadas nas linhas seguintes). */
export function primeiraLinha(error: unknown): string {
  return error instanceof Error ? error.message.split('\n')[0]! : String(error);
}

/** Rastro funcional de uma execução. `inicial` permite continuar os passos de outro rastro. */
export function criarRastro(inicial: Passo[] = []): Rastro {
  const passos = [...inicial];
  return {
    passos,
    async etapa<T>(texto: string, fn: () => Promise<T>): Promise<T> {
      try {
        const result = await fn();
        passos.push({ texto, status: 'ok' });
        return result;
      } catch (error) {
        passos.push({ texto, status: 'erro', erro: primeiraLinha(error) });
        throw error;
      }
    },
  };
}
