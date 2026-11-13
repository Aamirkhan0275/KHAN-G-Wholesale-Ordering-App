import { useState } from 'react';
import { useI18n } from '../../i18n';
import { useApi } from '../../lib/useApi';
import { ErrorBox, Spinner } from '../../components/ui';
import { Icon } from '../../components/Icon';

const TABS = [
  { key: 'summary', label: 'rep.summary' }, { key: 'sales-by-day', label: 'rep.byDay' }, { key: 'sales-by-shop', label: 'rep.byShop' },
  { key: 'products', label: 'rep.products' }, { key: 'balances', label: 'rep.balances' }, { key: 'low-stock', label: 'rep.lowStock' },
] as const;

const iso = (d: Date) => d.toISOString().slice(0, 10);

export default function Reports() {
  const { t, money, num, date } = useI18n();
  const [tab, setTab] = useState<(typeof TABS)[number]['key']>('summary');
  const [from, setFrom] = useState(iso(new Date(Date.now() - 29 * 86400000)));
  const [to, setTo] = useState(iso(new Date()));
  const qs = `from=${from}&to=${to}`;
  const { data, error, loading, reload } = useApi<{ rows: any[]; range: any }>(`/admin/reports/${tab}?${qs}`);
  const rows = data?.rows ?? [];
  const MONEY = new Set(['invoiced_total', 'payments_total', 'balance', 'outstanding_total', 'total_invoiced', 'total_credited']);
  const fmt = (k: string, v: any) => v === null || v === undefined ? '—' : MONEY.has(k) ? money(Number(v)) : typeof v === 'number' ? num(v) : /_at$/.test(k) ? date(v) : String(v);
  const maxDay = Math.max(1, ...rows.map((r) => Number(r.invoiced_total ?? 0)));
  return (
    <main className="page">
      <h1>{t('rep.title')}</h1>
      <div className="card form-grid" style={{ marginBottom: 12 }}>
        <label className="field"><span>{t('common.from')}</span><input className="input" type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className="field"><span>{t('common.to')}</span><input className="input" type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} /></label>
        <div className="field"><span>&nbsp;</span><a className="btn" href={`/api/admin/reports/${tab}?${qs}&format=csv`} data-testid="export-csv"><Icon name="download" />{t('common.export')}</a></div>
      </div>
      <div className="chips">{TABS.map((x) => <button key={x.key} className="chip" aria-pressed={tab === x.key} onClick={() => setTab(x.key)}>{t(x.label)}</button>)}</div>
      <p className="muted small">{t('rep.rules')}</p>
      <ErrorBox error={error} onRetry={reload} />
      {loading && !data && <Spinner />}
      {data && tab === 'summary' && rows[0] && (
        <div className="grid cols-4" data-testid="report-summary">
          <div className="stat"><span className="value">{num(rows[0].orders)}</span><span className="label">{t('rep.orders')}</span></div>
          <div className="stat"><span className="value">{num(rows[0].cancelled)}</span><span className="label">{t('rep.cancelled')}</span></div>
          <div className="stat"><span className="value">{num(rows[0].requested_units)}</span><span className="label">{t('rep.requestedUnits')}</span></div>
          <div className="stat"><span className="value">{num(rows[0].approved_units)}</span><span className="label">{t('rep.approvedUnits')}</span></div>
          <div className="stat"><span className="value" style={{ fontSize: '1.3rem' }}>{money(rows[0].invoiced_total)}</span><span className="label">{t('rep.invoiced')} ({num(rows[0].invoices)})</span></div>
          <div className="stat"><span className="value" style={{ fontSize: '1.3rem' }}>{money(rows[0].payments_total)}</span><span className="label">{t('rep.payments')} ({num(rows[0].payments)})</span></div>
          <div className="stat"><span className="value" style={{ fontSize: '1.3rem' }}>{money(rows[0].outstanding_total)}</span><span className="label">{t('rep.outstanding')} · {t('dash.shopsOwing', { n: rows[0].shops_owing })}</span></div>
        </div>
      )}
      {data && tab !== 'summary' && (
        rows.length === 0 ? <p className="muted">—</p> : (
          <div className="table-wrap">
            <table className="table" data-testid="report-table">
              <thead><tr>{Object.keys(rows[0]).filter((k) => !/(_id|^id)$/.test(k)).map((k) => <th key={k} className={typeof rows[0][k] === 'number' ? 'num' : ''}>{k.replace(/_/g, ' ')}</th>)}{tab === 'sales-by-day' && <th></th>}</tr></thead>
              <tbody>{rows.map((r, i) => (
                <tr key={i}>{Object.keys(r).filter((k) => !/(_id|^id)$/.test(k)).map((k) => <td key={k} className={typeof r[k] === 'number' ? 'num' : ''}>{fmt(k, r[k])}</td>)}
                  {tab === 'sales-by-day' && <td style={{ minWidth: 120 }}><div aria-hidden="true" style={{ height: 10, borderRadius: 5, background: 'var(--brand)', width: `${(Number(r.invoiced_total) / maxDay) * 100}%` }} /></td>}</tr>
              ))}</tbody>
            </table>
          </div>
        )
      )}
    </main>
  );
}
