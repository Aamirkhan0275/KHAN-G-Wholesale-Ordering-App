import { describe, expect, it } from 'vitest';
import { toCsv } from '../../server/lib/reports';
import { pdfSafe } from '../../server/lib/invoice-pdf';
import { passwordProblem } from '../../server/lib/auth';
import { loadEnv } from '../../server/lib/env';

describe('csv export', () => {
  it('escapes quotes/commas/newlines and guards against spreadsheet formulas', () => {
    const csv = toCsv([{ shop: 'A, "B"', note: '=HYPERLINK("x")', amount: -500, multi: 'a\nb' }]);
    expect(csv.startsWith('﻿')).toBe(true);
    expect(csv).toContain('"A, ""B"""');
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`);
    expect(csv).toContain(',-500,');
    expect(csv).toContain('"a\nb"');
  });
});

describe('pdf text', () => {
  it('drops characters the PDF font cannot draw', () => {
    expect(pdfSafe('Madina Store مدینہ')).toBe('Madina Store');
    expect(pdfSafe('مدینہ', 'Shop')).toBe('Shop');
    expect(pdfSafe('A – B “C”')).toBe('A - B "C"');
  });
});

describe('password policy', () => {
  it('rejects short/trivial passwords, accepts a 6+ digit PIN', () => {
    expect(passwordProblem('12345')).toBe('password_too_short');
    expect(passwordProblem('123456')).toBe('password_too_simple');
    expect(passwordProblem('111111')).toBe('password_too_simple');
    expect(passwordProblem('482913')).toBeNull();
    expect(passwordProblem(undefined)).toBe('password_required');
  });
});

describe('env', () => {
  it('requires a strong SESSION_SECRET in production', () => {
    expect(() => loadEnv({ DATABASE_URL: 'postgres://x', NODE_ENV: 'production', SESSION_SECRET: 'short' })).toThrow(/SESSION_SECRET/);
    expect(loadEnv({ DATABASE_URL: 'postgres://x', NODE_ENV: 'production', SESSION_SECRET: 'y'.repeat(40) }).cookieSecure).toBe(true);
  });
  it('builds DATABASE_URL from PG* variables', () => {
    expect(loadEnv({ PGHOST: 'db', PGUSER: 'u', PGPASSWORD: 'p@ss', PGDATABASE: 'kg' }).databaseUrl).toBe('postgres://u:p%40ss@db:5432/kg');
    expect(() => loadEnv({})).toThrow(/DATABASE_URL/);
  });
});

import { previousRange } from '../../server/lib/reports';
describe('report comparison range', () => {
  it('calendar months and years shift by whole units; other ranges by days', () => {
    expect(previousRange('2026-04-01', '2026-04-30', 'month')).toEqual({ prevFrom: '2026-03-01', prevTo: '2026-03-31' });
    expect(previousRange('2026-03-01', '2026-03-31', 'month')).toEqual({ prevFrom: '2026-02-01', prevTo: '2026-02-28' });
    expect(previousRange('2026-01-01', '2026-12-31', 'year')).toEqual({ prevFrom: '2025-01-01', prevTo: '2025-12-31' });
    expect(previousRange('2026-01-01', '2026-03-31', 'month')).toEqual({ prevFrom: '2025-10-01', prevTo: '2025-12-31' });
    expect(previousRange('2026-03-09', '2026-03-15', 'week')).toEqual({ prevFrom: '2026-03-02', prevTo: '2026-03-08' });
    expect(previousRange('2026-03-10', '2026-03-10', 'day')).toEqual({ prevFrom: '2026-03-09', prevTo: '2026-03-09' });
  });
});
