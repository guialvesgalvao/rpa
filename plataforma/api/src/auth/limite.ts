// Limite de tentativas de login por e-mail, em memória (a API roda com uma réplica; zera a cada deploy).
// Conta tentativas, não só falhas: quem chama registra antes de conferir a senha e limpa no sucesso.
export const MAXIMO_TENTATIVAS = 5;
export const JANELA_TENTATIVAS_MS = 15 * 60 * 1000;

export type Limite = {
  bloqueado(chave: string): boolean;
  registrarTentativa(chave: string): void;
  limpar(chave: string): void;
};

export function criarLimite(
  relogio: () => Date,
  { maximo = MAXIMO_TENTATIVAS, janelaMs = JANELA_TENTATIVAS_MS } = {},
): Limite {
  const tentativas = new Map<string, number[]>();
  let proximaVarredura = 0;

  const recentes = (chave: string, agora: number) =>
    (tentativas.get(chave) ?? []).filter((instante) => agora - instante < janelaMs);

  // Descarta as chaves sem tentativa recente, no máximo uma vez por janela: e-mails inventados não acumulam.
  function varrer(agora: number) {
    if (agora < proximaVarredura) return;
    proximaVarredura = agora + janelaMs;
    for (const chave of tentativas.keys()) {
      if (recentes(chave, agora).length === 0) tentativas.delete(chave);
    }
  }

  return {
    bloqueado(chave) {
      return recentes(chave, relogio().getTime()).length >= maximo;
    },
    registrarTentativa(chave) {
      const agora = relogio().getTime();
      varrer(agora);
      tentativas.set(chave, [...recentes(chave, agora), agora]);
    },
    limpar(chave) {
      tentativas.delete(chave);
    },
  };
}
