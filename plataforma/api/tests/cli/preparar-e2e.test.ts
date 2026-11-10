import { describe, expect, it } from 'vitest';

import { exigirBancoE2e } from '../../src/cli/preparar-e2e.js';

describe('exigirBancoE2e', () => {
  it('aceita banco local terminado em _e2e e devolve o nome', () => {
    expect(exigirBancoE2e('postgres://u:s@localhost:5433/rpa_e2e')).toBe('rpa_e2e');
    expect(exigirBancoE2e('postgres://u:s@127.0.0.1:5433/outro_e2e')).toBe('outro_e2e');
  });

  it('recusa os bancos de dev e de teste', () => {
    expect(() => exigirBancoE2e('postgres://u:s@localhost:5433/rpa')).toThrow(/_e2e/);
    expect(() => exigirBancoE2e('postgres://u:s@localhost:5433/rpa_teste')).toThrow(/_e2e/);
    expect(() => exigirBancoE2e('postgres://u:s@localhost:5433/')).toThrow(/_e2e/);
  });

  it('recusa host remoto e nome com caracteres fora do padrão', () => {
    expect(() => exigirBancoE2e('postgres://u:s@db.exemplo.com:5432/rpa_e2e')).toThrow(/localhost/);
    expect(() => exigirBancoE2e('postgres://u:s@localhost:5433/rpa-x_e2e')).toThrow(/_e2e/);
  });
});
