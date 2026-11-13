import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { en, type MessageKey } from './en';
import { ur } from './ur';

export type Lang = 'en' | 'ur';
const DICTS: Record<Lang, Record<MessageKey, string>> = { en, ur };

export function translate(lang: Lang, key: MessageKey, vars?: Record<string, string | number>): string {
  let s = DICTS[lang][key] ?? en[key] ?? key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
  return s;
}

export interface I18n {
  lang: Lang;
  dir: 'ltr' | 'rtl';
  t: (key: MessageKey, vars?: Record<string, string | number>) => string;
  /** Translate an API error code with a page-specific prefix fallback chain. */
  te: (code: string | undefined, prefixes?: string[]) => string;
  money: (n: number | null | undefined, currency?: string) => string;
  num: (n: number) => string;
  date: (d: string | Date, withTime?: boolean) => string;
  /** pick the Urdu value when in Urdu and it exists */
  pick: (en: string | null | undefined, ur: string | null | undefined) => string;
}

const Ctx = createContext<I18n | null>(null);

export function makeI18n(lang: Lang, timeZone = 'Asia/Karachi', currency = 'PKR'): I18n {
  const locale = lang === 'ur' ? 'ur-PK' : 'en-PK';
  const t = (key: MessageKey, vars?: Record<string, string | number>) => translate(lang, key, vars);
  return {
    lang,
    dir: lang === 'ur' ? 'rtl' : 'ltr',
    t,
    te: (code, prefixes = []) => {
      if (!code) return t('common.error');
      for (const p of [...prefixes, 'err', 'auth.err', 'cart.err', 'ao.err', 'ap.err', 'as.err', 'set.err', 'ac.err']) {
        const k = `${p}.${code}` as MessageKey;
        if (k in en) return t(k);
      }
      return t('common.error');
    },
    money: (n, cur = currency) => {
      if (n === null || n === undefined || Number.isNaN(n)) return '—';
      try {
        return new Intl.NumberFormat(locale, { style: 'currency', currency: cur, maximumFractionDigits: 0, numberingSystem: 'latn' } as any).format(n);
      } catch { return `${cur} ${Math.round(n)}`; }
    },
    num: (n) => new Intl.NumberFormat(locale, { numberingSystem: 'latn' } as any).format(n),
    date: (d, withTime = false) => {
      const date = typeof d === 'string' ? new Date(d.length === 10 ? d + 'T12:00:00Z' : d) : d;
      return new Intl.DateTimeFormat(locale, {
        timeZone, day: 'numeric', month: 'short', year: 'numeric', numberingSystem: 'latn',
        ...(withTime ? { hour: 'numeric', minute: '2-digit' } : {}),
      } as any).format(date);
    },
    pick: (e, u) => (lang === 'ur' && u ? u : e ?? u ?? ''),
  };
}

export function I18nProvider({ value, children }: { value: I18n; children: ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useI18n(): I18n {
  const v = useContext(Ctx);
  if (!v) throw new Error('I18nProvider missing');
  return v;
}

export function useMemoI18n(lang: Lang, tz?: string, currency?: string) {
  return useMemo(() => makeI18n(lang, tz, currency), [lang, tz, currency]);
}
