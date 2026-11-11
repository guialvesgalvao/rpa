import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Tudo local e fictício: banco `rpa_e2e`, API e site em portas próprias, nada do Bling.

export const RAIZ = fileURLToPath(new URL('../..', import.meta.url));

export const PORTA_API = 3101;
export const PORTA_SITE = 3100;
export const URL_API = `http://127.0.0.1:${PORTA_API}`;
// O site confere `Origin == SITE_URL`: o navegador precisa usar exatamente este endereço.
export const URL_SITE = `http://localhost:${PORTA_SITE}`;
/** Porta sem nada escutando: o app "sem conexão com o servidor". */
export const URL_API_MORTA = 'http://127.0.0.1:3199';
export const URL_BANCO = 'postgres://rpa:rpa@localhost:5433/rpa_e2e';
// Só para a API local da suíte; nunca usado fora dela.
export const JWT_SEGREDO_E2E = 'segredo-da-suite-e2e-local-0123456789abcdef';

// Usuários fictícios do `semear` e do `preparar-e2e` da plataforma (senha de dev, pública no repositório).
export const SENHA = 'senha-dev-1234';
export const USUARIOS = {
  admin: 'admin.dev@exemplo.com',
  finalista: 'finalista.dev@exemplo.com',
  desativavel: 'desativavel.e2e@exemplo.com',
  trocaSenha: 'troca.e2e@exemplo.com',
  soUsuarios: 'so-usuarios.e2e@exemplo.com',
  semAcesso: 'sem-acesso.e2e@exemplo.com',
  pedeCompras: 'pede-compras.e2e@exemplo.com',
  outraPedeCompras: 'outra-pede.e2e@exemplo.com',
  acompanhaCompras: 'acompanha-compras.e2e@exemplo.com',
} as const;
export type Perfil = keyof typeof USUARIOS;

export const ESTADO_SITE = {
  admin: 'e2e/.auth/site-admin.json',
  finalista: 'e2e/.auth/site-finalista.json',
} as const;

/** Variáveis da API da suíte: Bling e bucket vazios (contam como ausentes), banco `rpa_e2e`. */
export const ENV_API: Record<string, string> = {
  DATABASE_URL: URL_BANCO,
  PORT: String(PORTA_API),
  HOST: '127.0.0.1',
  JWT_SEGREDO: JWT_SEGREDO_E2E,
  BLING_CLIENT_ID: '',
  BLING_CLIENT_SECRET: '',
  BLING_REDIRECT_URI: '',
  BLING_CHAVE_TOKENS: '',
  BLING_SINCRONIZACAO_AUTOMATICA: '',
  ARQUIVOS_S3_ENDPOINT: '',
  ARQUIVOS_S3_REGIAO: '',
  ARQUIVOS_S3_BUCKET: '',
  ARQUIVOS_S3_CHAVE: '',
  ARQUIVOS_S3_SEGREDO: '',
};

/** Desativa um usuário direto no banco da E2E (a API não tem rota para isso). */
export function desativarUsuario(email: string): void {
  execFileSync(
    'npm',
    [
      '--prefix',
      'plataforma',
      '-w',
      '@plataforma/api',
      'run',
      'e2e:banco',
      '--',
      'desativar',
      email,
    ],
    { cwd: RAIZ, env: { ...process.env, DATABASE_URL: URL_BANCO }, stdio: 'pipe', shell: true },
  );
}

/** Garante que um endereço é local antes de qualquer cenário falar com ele. */
export function exigirLocal(url: string): void {
  const host = new URL(url).hostname;
  if (host !== 'localhost' && host !== '127.0.0.1') {
    throw new Error(`A suíte E2E só fala com endereços locais (recebido: ${url}).`);
  }
}
