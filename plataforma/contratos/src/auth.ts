import { z } from 'zod';

import { EsquemaArea } from './permissoes.ts';

// Os mesmos valores dos CHECKs de `usuarios.perfil` e `sessoes.origem` no banco.
export const EsquemaPerfil = z.enum(['admin', 'arte_finalista']);
export const EsquemaOrigem = z.enum(['web', 'desktop']);

export const EsquemaEntrar = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email()),
  // Limite só para não passar textos enormes pelo scrypt; o mínimo é regra do cadastro.
  senha: z.string().min(1).max(1024),
  origem: EsquemaOrigem,
});

export const EsquemaRenovacao = z.object({ renovacao: z.string().min(1).max(256) });

// `expiraEm`: fim da validade do token de acesso (ISO 8601).
export const EsquemaTokens = z.object({
  acesso: z.string(),
  renovacao: z.string(),
  expiraEm: z.iso.datetime(),
});

export const EsquemaEu = z.object({
  id: z.uuid(),
  nome: z.string(),
  email: z.email(),
  // Só para o app antigo; quem decide acesso são as permissões de cada empresa (`perfilLegado`).
  perfil: EsquemaPerfil,
  empresas: z.array(
    z.object({
      slug: z.string(),
      nome: z.string(),
      // Chaves do catálogo de permissões valendo nesta empresa. Texto livre de propósito: uma chave que esta
      // versão não conhece é ignorada por `temPermissao`, em vez de derrubar a sessão salva.
      permissoes: z.array(z.string()).default([]),
    }),
  ),
  area: EsquemaArea.nullable().catch(null).default(null),
  // Senha inicial definida pelo admin: a tela leva à troca. Ausente (API antiga ou sessão salva) = `false`.
  deveTrocarSenha: z.boolean().default(false),
});

export const EsquemaRespostaEntrar = EsquemaTokens.extend({ eu: EsquemaEu });

export const EsquemaErro = z.object({
  erro: z.object({ codigo: z.string(), mensagem: z.string() }),
});

export type Perfil = z.infer<typeof EsquemaPerfil>;
export type Origem = z.infer<typeof EsquemaOrigem>;
export type Entrar = z.infer<typeof EsquemaEntrar>;
export type Renovacao = z.infer<typeof EsquemaRenovacao>;
export type Tokens = z.infer<typeof EsquemaTokens>;
export type Eu = z.infer<typeof EsquemaEu>;
export type RespostaEntrar = z.infer<typeof EsquemaRespostaEntrar>;
export type Erro = z.infer<typeof EsquemaErro>;
