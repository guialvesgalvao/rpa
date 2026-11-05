import { describe, expect, it } from 'vitest';

import { formatarDataHoraBling } from '../../src/bling/datas.js';

describe('formatarDataHoraBling', () => {
  it('formata em AAAA-MM-DD HH:MM:SS no horário de Brasília', () => {
    expect(formatarDataHoraBling(new Date('2026-01-05T12:34:56.789Z'))).toBe('2026-01-05 09:34:56');
  });

  it('volta o dia (e o ano) quando o UTC já virou', () => {
    expect(formatarDataHoraBling(new Date('2026-01-01T02:30:05Z'))).toBe('2025-12-31 23:30:05');
  });

  it('usa 00 para a meia-noite, nunca 24', () => {
    expect(formatarDataHoraBling(new Date('2026-03-10T03:00:00Z'))).toBe('2026-03-10 00:00:00');
  });
});
