import { Link } from 'react-router-dom';
import { useI18n } from '../../i18n';
import { useApi } from '../../lib/useApi';
import { Icon } from '../../components/Icon';
import { ErrorBox, Spinner, StatusBadge } from '../../components/ui';

export default function Dashboard() {
  const { t, num, money, date, pick } = useI18n();
  const { data, error, loading, reload } = useApi<any>('/admin/dashboard');
  if (loading && !data) return <main className="page"><Spinner /></main>;
  if (error) return <main className="page"><ErrorBox error={error} onRetry={reload} /></main>;
  const d = data!;
  return (
    <main className="page">
      <div className="page-title row between"><h1>{t('nav.dashboard')}</h1><button className="btn btn-sm" onClick={reload}><Icon name="refresh" size={18} /></button></div>
      <div className="grid cols-4">
        <Link to="/admin/orders?status=submitted" className={`stat ${d.counts.new_orders ? 'alert' : ''}`} data-testid="stat-new"><span className="value">{num(d.counts.new_orders)}</span><span className="label">{t('dash.newOrders')}</span></Link>
        <Link to="/admin/orders?status=open" className={`stat ${d.counts.needs_action ? 'alert' : ''}`}><span className="value">{num(d.counts.needs_action)}</span><span className="label">{t('dash.needsAction')}</span></Link>
        <Link to="/admin/orders?status=confirmed" className="stat"><span className="value">{num(d.counts.to_deliver)}</span><span className="label">{t('dash.toDeliver')}</span></Link>
        <div className="stat"><span className="value">{num(d.counts.today_orders)}</span><span className="label">{t('dash.today')}</span></div>
        <Link to="/admin/stock" className={`stat ${d.lowStockCount ? 'alert' : ''}`}><span className="value">{num(d.lowStockCount)}</span><span className="label">{t('dash.lowStock')}</span></Link>
        <Link to="/admin/reports" className="stat"><span className="value" style={{ fontSize: '1.3rem' }}>{money(d.money.outstanding, d.currency)}</span><span className="label">{t('dash.outstanding')} · {t('dash.shopsOwing', { n: d.money.shops_owing })}</span></Link>
        <div className="stat"><span className="value" style={{ fontSize: '1.3rem' }}>{money(d.week.invoiced_7d, d.currency)}</span><span className="label">{t('dash.invoiced7')}</span></div>
        <Link to="/admin/shops" className="stat"><span className="value">{num(d.shops.active)}</span><span className="label">{t('dash.shops')} · {t('dash.pendingShops')}: {num(d.shops.pending)}</span></Link>
      </div>
      <div className="grid cols-2" style={{ marginTop: 14 }}>
        <section className="card">
          <div className="row between"><h2>{t('dash.recent')}</h2><Link to="/admin/orders">{t('dash.viewAll')}</Link></div>
          <div className="list" style={{ boxShadow: 'none' }}>
            {d.recent.map((o: any) => (
              <Link key={o.id} to={`/admin/orders/${o.id}`} className="list-item">
                <div className="grow"><div className="title"><span className="mono">{o.ref}</span> · {o.shop}</div><div className="sub">{date(o.submitted_at, true)} · {t('units.items', { n: o.item_count })}</div></div>
                <StatusBadge status={o.status} admin />
              </Link>
            ))}
          </div>
        </section>
        <section className="card">
          <div className="row between"><h2>{t('dash.lowStock')}</h2><Link to="/admin/stock">{t('dash.viewAll')}</Link></div>
          {d.lowStock.length === 0 ? <p className="muted">—</p> : (
            <div className="list" style={{ boxShadow: 'none' }}>
              {d.lowStock.map((p: any) => (
                <Link key={p.id} to={`/admin/products/${p.id}`} className="list-item">
                  <div className="grow"><div className="title">{pick(p.name_en, p.name_ur)}</div><div className="sub mono">{p.sku}</div></div>
                  <span className={`badge ${p.stock_qty <= 0 ? 'badge-bad' : 'badge-warn'}`}><Icon name={p.stock_qty <= 0 ? 'ban' : 'alert'} />{num(p.stock_qty)}</span>
                </Link>
              ))}
            </div>
          )}
          <h2 style={{ marginTop: 14 }}>{t('dash.topOwing')}</h2>
          {d.owing.length === 0 ? <p className="muted">—</p> : (
            <div className="list" style={{ boxShadow: 'none' }}>
              {d.owing.map((s: any) => <Link key={s.id} to={`/admin/shops/${s.id}`} className="list-item"><div className="grow title">{s.name}</div><b className="num">{money(s.balance, d.currency)}</b></Link>)}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
