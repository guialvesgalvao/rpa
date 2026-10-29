import type { Saude } from '@plataforma/contratos';

// Healthcheck do Railway: só confirma que o processo do site responde (não consulta a API).
export function GET() {
  return Response.json({ status: 'ok' } satisfies Saude);
}
