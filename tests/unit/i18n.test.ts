import { describe, expect, it } from 'vitest';
import { en } from '../../src/i18n/en';
import { ur } from '../../src/i18n/ur';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const files = (dir: string): string[] => readdirSync(dir).flatMap((f) => {
  const p = join(dir, f);
  return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(f) ? [p] : [];
});

describe('translations', () => {
  it('Urdu has exactly the same keys as English, none empty', () => {
    expect(Object.keys(ur).sort()).toEqual(Object.keys(en).sort());
    for (const [k, v] of Object.entries(ur)) expect(v.trim(), k).not.toBe('');
  });
  it('placeholders match between languages', () => {
    const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort();
    for (const k of Object.keys(en) as (keyof typeof en)[]) expect(ph(ur[k]), k).toEqual(ph(en[k]));
  });
  it('Urdu strings are actually Urdu script (not copied English) for user-facing labels', () => {
    const latinOnly = Object.entries(ur).filter(([k, v]) => !/[؀-ۿ]/.test(v) && !['lang.toggle', 'common.export'].includes(k) && !/^\{.*\}$/.test(v));
    expect(latinOnly.map(([k]) => k)).toEqual([]);
  });
  it('every t("key") used in the UI exists', () => {
    const used = new Set<string>();
    for (const f of files(join(process.cwd(), 'src'))) {
      for (const m of readFileSync(f, 'utf8').matchAll(/\bt\('([a-zA-Z0-9_.]+)'/g)) used.add(m[1]);
    }
    const missing = [...used].filter((k) => !(k in en));
    expect(missing).toEqual([]);
  });
});
