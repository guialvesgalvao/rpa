import { type Eu, type Permissao, SENHA_MINIMA, temPermissao } from '@plataforma/contratos';

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

// Empresas do usuário em que ele tem a permissão, na ordem do seletor: as que ele pode dar a outro usuário
// (`usuarios.editar`) ou em que pode marcar permissões (`usuarios.permissoes`).
export function empresasCom(eu: Pick<Eu, 'empresas'>, chave: Permissao): Empresa[] {
  return ordenarEmpresas(eu.empresas.filter((empresa) => temPermissao(empresa.permissoes, chave)));
}
