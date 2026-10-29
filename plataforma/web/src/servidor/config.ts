import { z } from 'zod';

const schema = z.object({
  // Endereço da API visto pelo servidor do site (rede privada do Railway em produção).
  API_URL_INTERNA: z.url(),
  // Endereço público do site: base dos redirecionamentos e `Origin` esperado nos POST.
  SITE_URL: z.url(),
});

// Fora de produção (dev e testes), a API e o site locais das portas padrão.
const PADROES_LOCAIS = {
  API_URL_INTERNA: 'http://localhost:3001',
  SITE_URL: 'http://localhost:3000',
};

export type ConfigSite = { apiUrl: string; siteUrl: string };

export function lerConfig(env: NodeJS.ProcessEnv = process.env): ConfigSite {
  const padroes = env.NODE_ENV === 'production' ? {} : PADROES_LOCAIS;
  const parsed = schema.parse({ ...padroes, ...env });
  return { apiUrl: parsed.API_URL_INTERNA, siteUrl: parsed.SITE_URL };
}
