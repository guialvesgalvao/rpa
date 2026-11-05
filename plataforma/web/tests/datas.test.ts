import { describe, expect, it } from 'vitest';

import { formatarDataHora } from '../src/datas';

describe('formatarDataHora', () => {
  it('mostra data e hora no fuso de São Paulo, qualquer que seja o do servidor', () => {
    expect(formatarDataHora('2026-11-05T17:32:00.000Z')).toBe('05/11/2026 14:32');
    // Virada do dia em UTC ainda é o dia anterior em São Paulo.
    expect(formatarDataHora('2026-11-06T01:05:00.000Z')).toBe('05/11/2026 22:05');
  });
});
