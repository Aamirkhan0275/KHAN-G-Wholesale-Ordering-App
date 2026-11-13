import type { Lang } from '../i18n';

export type Theme = 'system' | 'light' | 'dark';
const LANG_KEY = 'kg.lang';
const THEME_KEY = 'kg.theme';

function read(key: string): string | null { try { return localStorage.getItem(key); } catch { return null; } }
function write(key: string, v: string) { try { localStorage.setItem(key, v); } catch { /* private mode */ } }

export function savedLang(): Lang {
  const v = read(LANG_KEY);
  if (v === 'en' || v === 'ur') return v;
  return navigator.language?.toLowerCase().startsWith('ur') ? 'ur' : 'en';
}
export function savedTheme(): Theme {
  const v = read(THEME_KEY);
  return v === 'light' || v === 'dark' ? v : 'system';
}

export function applyLang(lang: Lang) {
  write(LANG_KEY, lang);
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === 'ur' ? 'rtl' : 'ltr';
}

export function resolvedTheme(theme: Theme): 'light' | 'dark' {
  if (theme !== 'system') return theme;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function applyTheme(theme: Theme) {
  write(THEME_KEY, theme);
  const r = resolvedTheme(theme);
  document.documentElement.dataset.theme = r;
  document.documentElement.style.colorScheme = r;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', r === 'dark' ? '#0f1714' : '#0f6b4a');
}
