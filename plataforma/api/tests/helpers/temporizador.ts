import type { Temporizador } from '../../src/bling/agendador.js';

// Temporizador falso: guarda os agendamentos; o teste dispara o próximo.
export function temporizadorFalso() {
  const agendados: { fn: () => void; ms: number; ativo: boolean }[] = [];
  const temporizador: Temporizador = {
    agendar(fn, ms) {
      const item = { fn, ms, ativo: true };
      agendados.push(item);
      return () => {
        item.ativo = false;
      };
    },
  };
  const ativos = () => agendados.filter((item) => item.ativo);
  return {
    temporizador,
    agendados,
    ativos,
    disparar() {
      const [proximo] = ativos();
      if (!proximo) throw new Error('nada agendado');
      proximo.ativo = false;
      proximo.fn();
    },
  };
}
