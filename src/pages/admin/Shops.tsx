import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useI18n } from '../../i18n';
import { useApi } from '../../lib/useApi';
import { formatPhone } from '../../../shared/phone';
import { Icon } from '../../components/Icon';
import { Empty, ErrorBox, Spinner } from '../../components/ui';

export function ShopStatus({ status }: { status: string }) {
  const { t } = useI18n();
  const cls = status === 'active' ? 'badge-ok' : status === 'pending' ? 'badge-warn' : 'badge-muted';
  const icon = status === 'active' ? 'check' : status === 'pending' ? 'clock' : 'ban';
  return <span className={`badge ${cls}`}><Icon name={icon} />{t(`as.status.${status}` as any)}</span>;
}

export default function Shops() {
  const { t, money, date } = useI18n();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('all');
  const { data, error, loading, reload } = useApi<{ shops: any[] }>(`/admin/shops?status=${status}&q=${encodeURIComponent(q)}`);
  return (
    <main className="page">
      <div className="page-title row between wrap"><h1>{t('nav.shops')}</h1>
        <div className="row wrap"><a className="btn btn-sm" href="/api/admin/shops?format=csv" data-testid="customers-csv"><Icon name="download" size={18} />{t('cust.exportCsv')}</a>
        <Link to="/admin/shops/new" className="btn btn-primary" data-testid="add-shop"><Icon name="plus" />{t('as.add')}</Link></div></div>
      <div className="search"><Icon name="search" /><input className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('common.search')} aria-label={t('common.search')} /></div>
      <div className="chips">{['all', 'pending', 'active', 'inactive'].map((s) => <button key={s} className="chip" aria-pressed={status === s} onClick={() => setStatus(s)}>{s === 'all' ? t('common.all') : t(`as.status.${s}` as any)}</button>)}</div>
      <ErrorBox error={error} onRetry={reload} />
      {loading && !data && <Spinner />}
      {data && data.shops.length === 0 && <Empty icon="store">{t('as.empty')}</Empty>}
      {data && data.shops.length > 0 && (
        <div className="list" data-testid="shops-list">
          {data.shops.map((s) => (
            <Link key={s.id} to={`/admin/shops/${s.id}`} className="list-item">
              <Icon name="store" />
              <div className="grow">
                <div className="row wrap"><span className="title">{s.name}</span><ShopStatus status={s.status} /></div>
                <div className="sub">{s.full_name} · <span className="ltr">{formatPhone(s.phone)}</span>{s.city || s.area ? ` · ${[s.area, s.city].filter(Boolean).join(', ')}` : ''} · {t('as.lastOrder')}: {s.last_order_at ? date(s.last_order_at) : t('as.never')}</div>
              </div>
              <div className="num" style={{ fontWeight: 800, color: s.balance > 0 ? 'var(--warn)' : undefined }}>{money(s.balance)}</div>
              <Icon name="chev" className="chev" />
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}
