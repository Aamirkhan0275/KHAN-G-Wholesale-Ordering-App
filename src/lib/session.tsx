import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, ApiFailure, onUnauthorized } from './api';
import { applyLang, applyTheme, savedLang, savedTheme, type Theme } from './prefs';
import { I18nProvider, makeI18n, type Lang } from '../i18n';
import { clearCatalogueCache } from './catalogue';

export interface Me {
  id: string; role: 'admin' | 'shopkeeper'; full_name: string; phone: string; status: string;
  language: Lang; theme: Theme; reminders_opt_out: boolean; must_change_password: boolean;
  shop_id: string | null; shop_name: string | null;
}
export interface PublicSettings {
  business_name: string; business_name_ur: string | null; business_whatsapp: string | null;
  currency: string; show_prices: boolean; timezone: string;
}

interface SessionCtx {
  loading: boolean;
  me: Me | null;
  settings: PublicSettings | null;
  lang: Lang;
  theme: Theme;
  setLang: (l: Lang) => void;
  setTheme: (t: Theme) => void;
  setRemindersOptOut: (v: boolean) => Promise<void>;
  login: (phone: string, password: string) => Promise<Me>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const Ctx = createContext<SessionCtx | null>(null);
const SESSION_CACHE = 'kg.session.v1';
function loadCachedSession(): { user: Me; settings: PublicSettings } | null {
  try { return JSON.parse(localStorage.getItem(SESSION_CACHE) ?? 'null'); } catch { return null; }
}
function saveCachedSession(v: { user: Me; settings: PublicSettings } | null) {
  try { if (v) localStorage.setItem(SESSION_CACHE, JSON.stringify(v)); else localStorage.removeItem(SESSION_CACHE); } catch { /* ignore */ }
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [me, setMe] = useState<Me | null>(null);
  const [settings, setSettings] = useState<PublicSettings | null>(null);
  const [lang, setLangState] = useState<Lang>(savedLang());
  const [theme, setThemeState] = useState<Theme>(savedTheme());

  useEffect(() => { applyLang(lang); }, [lang]);
  useEffect(() => {
    applyTheme(theme);
    if (theme !== 'system') return;
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
    const fn = () => applyTheme('system');
    mq?.addEventListener?.('change', fn);
    return () => mq?.removeEventListener?.('change', fn);
  }, [theme]);

  const refresh = useCallback(async () => {
    try {
      const r = await api<{ user: Me; settings: PublicSettings }>('/auth/me');
      setMe(r.user);
      setSettings(r.settings);
      setLangState(r.user.language);
      setThemeState(r.user.theme);
      saveCachedSession({ user: r.user, settings: r.settings });
    } catch (e) {
      if (e instanceof ApiFailure && e.code === 'network') {
        // Offline: reopen with the last signed-in profile so cached screens still show.
        // The server still checks the real session on every request once online.
        const cached = loadCachedSession();
        setMe((m) => m ?? cached?.user ?? null);
        setSettings((s) => s ?? cached?.settings ?? null);
      } else {
        setMe(null);
        saveCachedSession(null);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => onUnauthorized(() => { setMe(null); saveCachedSession(null); }), []);

  const savePref = useCallback((patch: Record<string, unknown>) => {
    if (!me) return Promise.resolve();
    return api('/me/preferences', { method: 'PATCH', body: patch }).then(() => undefined).catch(() => undefined);
  }, [me]);

  const value = useMemo<SessionCtx>(() => ({
    loading, me, settings, lang, theme,
    setLang: (l) => { setLangState(l); void savePref({ language: l }); },
    setTheme: (t) => { setThemeState(t); void savePref({ theme: t }); },
    setRemindersOptOut: async (v) => {
      await api('/me/preferences', { method: 'PATCH', body: { reminders_opt_out: v } });
      setMe((m) => (m ? { ...m, reminders_opt_out: v } : m));
    },
    login: async (phone, password) => {
      clearCatalogueCache();
      const r = await api<{ user: Me }>('/auth/login', { body: { phone, password } });
      await refresh();
      return r.user;
    },
    logout: async () => {
      await api('/auth/logout', { method: 'POST' }).catch(() => undefined);
      clearCatalogueCache();
      saveCachedSession(null);
      setMe(null);
    },
    refresh,
  }), [loading, me, settings, lang, theme, savePref, refresh]);

  const i18n = useMemo(() => makeI18n(lang, settings?.timezone, settings?.currency), [lang, settings?.timezone, settings?.currency]);
  return <Ctx.Provider value={value}><I18nProvider value={i18n}>{children}</I18nProvider></Ctx.Provider>;
}

export function useSession() {
  const v = useContext(Ctx);
  if (!v) throw new Error('SessionProvider missing');
  return v;
}
