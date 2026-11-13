import { useMemo } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useI18n } from '../../i18n';
import { useApi } from '../../lib/useApi';
import { ORDER_STATUSES } from '../../../shared/status';
import { Empty, ErrorBox, Spinner, StatusBadge } from '../../components/ui';
import { Icon } from '../../components/Icon';
import type { MessageKey } from '../../i18n/en';

export default function AdminOrders() {
  const { t, date, num, money } = useI18n();
  const [params, setParams] = useSearchParams();
  const nav = useNavigate();
  const status = params.get('status') ?? 'all';
  const shop = params.get('shop') ?? '';
  const from = params.get('from') ?? '';
  const to = params.get('to') ?? '';
  const q = params.get('q') ?? '';
  const qs = useMemo(() => new URLSearchParams(Object.entries({ status, shop, from, to, q }).filter(([, v]) => v)).toString(), [status, shop, from, to, q]);
  const { data, error, loading, reload } = useApi<{ orders: any[] }>(`/admin/orders?${qs}`);
  const shops = useApi<{ shops: any[] }>('/admin/shops');
  const set = (k: string, v: string) => { const p = new URLSearchParams(params); if (v) p.set(k, v); else p.delete(k); setParams(p, { replace: true }); };
  return (
    <main className="page">
      <div className="page-title row between"><h1>{t('nav.adminOrders')}</h1><button className="btn btn-sm" onClick={reload}><Icon name="refresh" size={18} /></button></div>
      <div className="card form-grid" style={{ marginBottom: 12 }}>
        <label className="field"><span>{t('common.status')}</span>
          <select className="input" value={status} onChange={(e) => set('status', e.target.value)} data-testid="filter-status">
            <option value="all">{t('common.all')}</option>
            <option value="open">{t('ao.open')}</option>
            {ORDER_STATUSES.map((s) => <option key={s} value={s}>{['submitted', 'checking', 'needs_confirmation'].includes(s) ? t(`status.admin.${s}` as MessageKey) : t(`status.${s}` as MessageKey)}</option>)}
          </select></label>
        <label className="field"><span>{t('acc.shop')}</span>
          <select className="input" value={shop} onChange={(e) => set('shop', e.target.value)}>
            <option value="">{t('ao.allShops')}</option>
            {shops.data?.shops.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select></label>
        <label className="field"><span>{t('common.from')}</span><input className="input" type="date" value={from} onChange={(e) => set('from', e.target.value)} /></label>
        <label className="field"><span>{t('common.to')}</span><input className="input" type="date" value={to} onChange={(e) => set('to', e.target.value)} /></label>
        <label className="field"><span>{t('common.search')}</span><input className="input" value={q} placeholder="KG-…" onChange={(e) => set('q', e.target.value)} /></label>
      </div>
      <ErrorBox error={error} onRetry={reload} />
      {loading && !data && <Spinner />}
      {data && data.orders.length === 0 && <Empty icon="list">{t('ao.empty')}</Empty>}
      {data && data.orders.length > 0 && (
        <div className="table-wrap">
          <table className="table" data-testid="admin-orders">
            <thead><tr><th>{t('done.ref')}</th><th>{t('acc.shop')}</th><th>{t('common.date')}</th><th className="num">{t('common.items')}</th><th className="num">{t('common.total')}</th><th>{t('common.status')}</th></tr></thead>
            <tbody>
              {data.orders.map((o) => (
                <tr key={o.id} className="clickable" onClick={() => nav(`/admin/orders/${o.id}`)}>
                  <td><Link to={`/admin/orders/${o.id}`} className="mono" onClick={(e) => e.stopPropagation()}>{o.ref}</Link></td>
                  <td>{o.shop}{o.whatsapp_opened_at && <Icon name="whatsapp" size={16} className="muted" title="WhatsApp" />}</td>
                  <td>{date(o.submitted_at, true)}</td>
                  <td className="num">{num(o.item_count)} / {num(o.total_approved_qty ?? o.total_requested_qty)}</td>
                  <td className="num">{money(o.approved_total ?? o.requested_total, o.currency)}</td>
                  <td><StatusBadge status={o.status} admin />{o.invoice_no && <span className="badge badge-info" style={{ marginInlineStart: 4 }}><Icon name="file" />{o.invoice_no}</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
