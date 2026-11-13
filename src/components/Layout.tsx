import { NavLink, Outlet, Link } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { Icon } from './Icon';
import { useI18n } from '../i18n';
import { useSession } from '../lib/session';
import { useCart } from '../lib/cart';
import { api } from '../lib/api';
import { useOnline } from './ui';
import type { MessageKey } from '../i18n/en';

export function useUnread(enabled: boolean, path = '/notifications') {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const load = () => api<{ unread: number }>(path).then((r) => alive && setN(r.unread)).catch(() => {});
    load();
    const id = setInterval(load, 60_000);
    const onFocus = () => load();
    window.addEventListener('focus', onFocus);
    window.addEventListener('kg:notifications', onFocus);
    return () => { alive = false; clearInterval(id); window.removeEventListener('focus', onFocus); window.removeEventListener('kg:notifications', onFocus); };
  }, [enabled, path]);
  return n;
}

export function HeaderControls() {
  const { lang, setLang, theme, setTheme } = useSession();
  const { t } = useI18n();
  const next = theme === 'dark' ? 'light' : theme === 'light' ? 'system' : 'dark';
  return (
    <>
      <button className="icon-btn" onClick={() => setLang(lang === 'ur' ? 'en' : 'ur')} aria-label={`${t('acc.language')}: ${t('lang.toggle')}`} data-testid="lang-toggle">
        <Icon name="globe" size={20} /><span className={lang === 'ur' ? 'ltr' : ''} style={{ fontSize: '.92rem' }}>{t('lang.toggle')}</span>
      </button>
      <button className="icon-btn" onClick={() => setTheme(next)} aria-label={`${t('theme.label')}: ${t(`theme.${theme}` as MessageKey)}`} title={t(`theme.${theme}` as MessageKey)} data-testid="theme-toggle">
        <Icon name={theme === 'dark' ? 'moon' : theme === 'light' ? 'sun' : 'contrast'} size={22} />
      </button>
    </>
  );
}

function Header({ home, notifPath }: { home: string; notifPath: string }) {
  const { settings, me, lang } = useSession();
  const { t } = useI18n();
  const unread = useUnread(!!me, me?.role === 'admin' ? '/admin/pending-count' : '/notifications');
  const name = lang === 'ur' && settings?.business_name_ur ? settings.business_name_ur : settings?.business_name ?? t('app.name');
  return (
    <header className="app-header">
      <Link to={home} className="brand"><img src="/icons/icon-192.png" alt="" /><span>{name}</span></Link>
      <div className="spacer" />
      <HeaderControls />
      <Link to={notifPath} className="icon-btn" aria-label={`${me?.role === 'admin' ? t('dash.newOrders') : t('nav.notifications')}${unread ? ` (${unread})` : ''}`} data-testid="bell">
        <Icon name="bell" />{unread > 0 && <span className="dot">{unread > 9 ? '9+' : unread}</span>}
      </Link>
    </header>
  );
}

function OfflineBar() {
  const online = useOnline();
  const { t } = useI18n();
  return online ? null : <div className="offline-bar" role="status">{t('common.offline')}</div>;
}

export function ShopLayout() {
  const { t } = useI18n();
  const { lines } = useCart();
  return (
    <>
      <Header home="/" notifPath="/notifications" />
      <OfflineBar />
      <Outlet />
      <nav className="bottom-nav" aria-label="Main">
        <NavLink to="/" end><Icon name="home" />{t('nav.catalogue')}</NavLink>
        <NavLink to="/cart" data-testid="nav-cart"><Icon name="cart" />{t('nav.cart')}{lines.length > 0 && <span className="badge-count">{lines.length}</span>}</NavLink>
        <NavLink to="/orders"><Icon name="list" />{t('nav.orders')}</NavLink>
        <NavLink to="/account"><Icon name="user" />{t('nav.account')}</NavLink>
      </nav>
    </>
  );
}

export const ADMIN_LINKS: { to: string; icon: string; key: MessageKey; end?: boolean }[] = [
  { to: '/admin', icon: 'home', key: 'nav.dashboard', end: true },
  { to: '/admin/orders', icon: 'list', key: 'nav.adminOrders' },
  { to: '/admin/products', icon: 'box', key: 'nav.products' },
  { to: '/admin/categories', icon: 'tag', key: 'nav.categories' },
  { to: '/admin/stock', icon: 'refresh', key: 'nav.stock' },
  { to: '/admin/shops', icon: 'store', key: 'nav.shops' },
  { to: '/admin/invoices', icon: 'file', key: 'nav.invoices' },
  { to: '/admin/reports', icon: 'chart', key: 'nav.reports' },
  { to: '/admin/reminders', icon: 'bell', key: 'nav.reminders' },
  { to: '/admin/settings', icon: 'settings', key: 'nav.settings' },
];

export function AdminLayout() {
  const { t } = useI18n();
  return (
    <>
      <Header home="/admin" notifPath="/admin/orders?status=submitted" />
      <OfflineBar />
      <div className="admin-shell">
        <nav className="sidebar" aria-label="Admin">
          {ADMIN_LINKS.map((l) => <NavLink key={l.to} to={l.to} end={l.end}><Icon name={l.icon} size={20} />{t(l.key)}</NavLink>)}
        </nav>
        <div><Outlet /></div>
        <nav className="bottom-nav" aria-label="Admin">
          <NavLink to="/admin" end><Icon name="home" />{t('nav.dashboard')}</NavLink>
          <NavLink to="/admin/orders"><Icon name="list" />{t('nav.adminOrders')}</NavLink>
          <NavLink to="/admin/products"><Icon name="box" />{t('nav.products')}</NavLink>
          <NavLink to="/admin/shops"><Icon name="store" />{t('nav.shops')}</NavLink>
          <NavLink to="/admin/more"><Icon name="menu" />{t('nav.more')}</NavLink>
        </nav>
      </div>
    </>
  );
}
