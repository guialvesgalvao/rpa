import { criarApp } from '../../src/app.js';
import type { Banco } from '../../src/db/cliente.js';

// Segredo fictício, só para os testes.
export const SEGREDO_TESTE = 'segredo-ficticio-dos-testes-0123456789';

export type RelogioFalso = { agora: () => Date; avancar: (ms: number) => void };

export function criarRelogioFalso(inicio = new Date('2026-01-05T12:00:00.000Z')): RelogioFalso {
  let atual = inicio.getTime();
  return {
    agora: () => new Date(atual),
    avancar: (ms) => {
      atual += ms;
    },
  };
}

export function criarAppTeste(db: Banco) {
  const relogio = criarRelogioFalso();
  const app = criarApp({ db, jwtSegredo: SEGREDO_TESTE, relogio: relogio.agora });
  return { app, relogio };
}
