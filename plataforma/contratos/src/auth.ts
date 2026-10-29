import { z } from 'zod';

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
  perfil: EsquemaPerfil,
  empresas: z.array(z.object({ slug: z.string(), nome: z.string() })),
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
