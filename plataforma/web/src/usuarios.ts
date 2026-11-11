import { SENHA_MINIMA } from '@plataforma/contratos';

import { ordenarEmpresas, type Empresa } from './empresas';

// Recusas da troca de senha que a página `/trocar-senha` sabe explicar (`?erro=<codigo>`); o resto vira a
// mensagem genérica. Nunca mostra texto vindo da URL.
const MENSAGENS_TROCA_SENHA: Record<string, string> = {
  senha_atual_incorreta: 'Senha atual incorreta.',
  senha_repetida: 'A nova senha precisa ser diferente da atual.',
  senha_curta: `A nova senha precisa de ao menos ${SENHA_MINIMA} caracteres.`,
  confirmacao: 'A confirmação não confere com a nova senha.',
  muitas_tentativas: 'Muitas tentativas; aguarde alguns minutos.',
};

export function mensagemTrocaSenha(codigo: unknown): string | undefined {
  if (codigo === undefined) return undefined;
  return (
    (typeof codigo === 'string' && Object.hasOwn(MENSAGENS_TROCA_SENHA, codigo)
      ? MENSAGENS_TROCA_SENHA[codigo]
      : undefined) ?? 'Não foi possível trocar a senha. Tente novamente.'
  );
}

// Empresas que o admin pode dar ao usuário novo: as dele. Com uma só, ela vem fixa (marcada e travada).
export function opcoesDeEmpresa<T extends Pick<Empresa, 'slug' | 'nome'>>(
  empresasAdmin: readonly T[],
): {
  opcoes: T[];
  fixa: boolean;
} {
  const opcoes = ordenarEmpresas(empresasAdmin);
  return { opcoes, fixa: opcoes.length === 1 };
}
