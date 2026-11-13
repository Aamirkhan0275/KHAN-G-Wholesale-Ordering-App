import { useState } from 'react';
import { useI18n } from '../../i18n';
import { useApi } from '../../lib/useApi';
import { ErrorBox, Spinner } from '../../components/ui';
import { Icon } from '../../components/Icon';
import type { MessageKey } from '../../i18n/en';

const TABS = [
  { key: 'sales-by-period', label: 'rep.byPeriod' }, { key: 'summary', label: 'rep.summary' }, { key: 'sales-by-shop', label: 'rep.byShop' },
  { key: 'products', label: 'rep.products' }, { key: 'balances', label: 'rep.balances' }, { key: 'low-stock', label: 'rep.lowStock' },
] as const;
type Period = 'day' | 'week' | 'month' | 'year';

const iso = (d: Date) => d.toISOString().slice(0, 10);
/** Today's date in Pakistan time (business timezone default). */
function todayPk() { return new Date(Date.now() + 5 * 3600e3); }

export function presetRange(preset: string): { from: string; to: string; period: Period } {
  const n = todayPk();
  const y = n.getUTCFullYear(), m = n.getUTCMonth(), d = n.getUTCDate();
  const dow = (n.getUTCDay() + 6) % 7; // Monday = 0
  switch (preset) {
    case 'today': return { from: iso(n), to: iso(n), period: 'day' };
    case 'thisWeek': return { from: iso(new Date(Date.UTC(y, m, d - dow))), to: iso(n), period: 'day' };
    case 'thisMonth': return { from: iso(new Date(Date.UTC(y, m, 1))), to: iso(new Date(Date.UTC(y, m + 1, 0))), period: 'day' };
    case 'lastMonth': return { from: iso(new Date(Date.UTC(y, m - 1, 1))), to: iso(new Date(Date.UTC(y, m, 0))), period: 'day' };
    case 'thisYear': return { from: `${y}-01-01`, to: `${y}-12-31`, period: 'month' };
    case 'last12': return { from: iso(new Date(Date.UTC(y, m - 11, 1))), to: iso(new Date(Date.UTC(y, m + 1, 0))), period: 'month' };
    case 'last5y': return { from: `${y - 4}-01-01`, to: `${y}-12-31`, period: 'year' };
    default: return { from: iso(new Date(Date.UTC(y, m, d - 29))), to: iso(n), period: 'day' };
  }
}

function Change({ cur, prev }: { cur: number; prev: number }) {
  if (!prev && !cur) return null;
  if (!prev) return <span className="change-up small">▲</span>;
  const pct = Math.round(((cur - prev) / prev) * 100);
  return <span className={`small ${pct >= 0 ? 'change-up' : 'change-down'}`}>{pct >= 0 ? '▲' : '▼'} {Math.abs(pct)}%</span>;
}

function PeriodReport() {
  const { t, money, num, date } = useI18n();
  const [preset, setPreset] = useState('thisMonth');
  const init = presetRange('thisMonth');
  const [from, setFrom] = useState(init.from);
  const [to, setTo] = useState(init.to);
  const [period, setPeriod] = useState<Period>(init.period);
  const qs = `period=${period}&from=${from}&to=${to}`;
  const { data, error, loading, reload } = useApi<any>(`/admin/reports/sales-by-period?${qs}`);
  const choose = (p: string) => { const r = presetRange(p); setPreset(p); setFrom(r.from); setTo(r.to); setPeriod(r.period); };
  const rows: any[] = data?.rows ?? [];
  const max = Math.max(1, ...rows.map((r) => Number(r.invoiced_total)));
  const cols = ['orders', 'cancelled', 'shops', 'requested_units', 'confirmed_units', 'invoices', 'invoiced_total', 'payments_total'];
  const isMoney = (k: string) => k.endsWith('_total');
  return (
    <section data-testid="period-report">
      <div className="chips" role="toolbar" aria-label={t('rep.byPeriod')}>
        {['today', 'thisWeek', 'thisMonth', 'lastMonth', 'thisYear', 'last12', 'last5y'].map((p) => (
          <button key={p} className="chip" aria-pressed={preset === p} onClick={() => choose(p)} data-testid={`preset-${p}`}>{t(`rep.preset.${p}` as MessageKey)}</button>
        ))}
      </div>
      <div className="card form-grid" style={{ margin: '8px 0 12px' }}>
        <div className="field"><span>{t('rep.col.period')}</span>
          <div className="segmented">{(['day', 'week', 'month', 'year'] as Period[]).map((p) => (
            <button key={p} aria-pressed={period === p} onClick={() => setPeriod(p)} data-testid={`period-${p}`}>{t(`rep.period.${p}` as MessageKey)}</button>))}</div></div>
        <label className="field"><span>{t('common.from')}</span><input className="input" type="date" value={from} max={to} onChange={(e) => { setFrom(e.target.value); setPreset('custom'); }} /></label>
        <label className="field"><span>{t('common.to')}</span><input className="input" type="date" value={to} min={from} onChange={(e) => { setTo(e.target.value); setPreset('custom'); }} /></label>
        <div className="field"><span>&nbsp;</span><a className="btn" href={`/api/admin/reports/sales-by-period?${qs}&format=csv`} data-testid="export-csv"><Icon name="download" />{t('common.export')}</a></div>
      </div>
      <ErrorBox error={error} onRetry={reload} />
      {loading && !data && <Spinner />}
      {data && (
        <>
          <div className="grid cols-4" data-testid="period-totals">
            {([['orders', 'rep.orders'], ['invoiced_total', 'rep.invoiced'], ['payments_total', 'rep.payments'], ['confirmed_units', 'rep.approvedUnits']] as const).map(([k, label]) => (
              <div className="stat" key={k}>
                <span className="value" style={isMoney(k) ? { fontSize: '1.3rem' } : undefined}>{isMoney(k) ? money(data.totals[k]) : num(data.totals[k])}</span>
                <span className="label">{t(label)}</span>
                <span className="small muted"><Change cur={data.totals[k]} prev={data.previous.totals[k]} /> {t('rep.vsPrevious', { from: date(data.previous.from), to: date(data.previous.to) })}</span>
              </div>
            ))}
          </div>
          <div className="card" style={{ marginTop: 12 }}>
            <div className="muted small" style={{ fontWeight: 700 }}>{t('rep.invoiced')}</div>
            <div className="bars" role="img" aria-label={t('rep.invoiced')} data-testid="period-chart">
              {rows.map((r) => (
                <div className="bar" key={r.period} title={`${r.period}: ${money(r.invoiced_total)} · ${r.orders} ${t('rep.orders')}`}>
                  <span style={{ height: `${(Number(r.invoiced_total) / max) * 100}%` }} />
                  <small>{period === 'day' ? r.period.slice(5) : r.period}</small>
                </div>
              ))}
            </div>
          </div>
          <div className="table-wrap" style={{ marginTop: 12 }}>
            <table className="table" data-testid="report-table">
              <thead><tr><th>{t('rep.col.period')}</th>{cols.map((k) => <th key={k} className="num">{t(`rep.col.${k}` as MessageKey)}</th>)}</tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.period}><td className="mono">{r.period}{period === 'week' && <div className="muted small">{date(r.period_start)} – {date(r.period_end)}</div>}</td>
                    {cols.map((k) => <td key={k} className="num">{isMoney(k) ? money(r[k]) : num(r[k])}</td>)}</tr>
                ))}
                <tr style={{ fontWeight: 900 }}><td>{t('rep.totals')}</td>{cols.map((k) => <td key={k} className="num">{k === 'shops' ? '' : isMoney(k) ? money(data.totals[k]) : num(data.totals[k] ?? 0)}</td>)}</tr>
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}

export default function Reports() {
  const { t, money, num, date } = useI18n();
  const [tab, setTab] = useState<(typeof TABS)[number]['key']>('sales-by-period');
  const [from, setFrom] = useState(iso(new Date(Date.now() - 29 * 86400000)));
  const [to, setTo] = useState(iso(new Date()));
  const qs = `from=${from}&to=${to}`;
  const { data, error, loading, reload } = useApi<{ rows: any[]; range: any }>(tab === 'sales-by-period' ? null : `/admin/reports/${tab}?${qs}`);
  const rows = data?.rows ?? [];
  const MONEY = new Set(['invoiced_total', 'payments_total', 'balance', 'outstanding_total', 'total_invoiced', 'total_credited']);
  const fmt = (k: string, v: any) => v === null || v === undefined ? '—' : MONEY.has(k) ? money(Number(v)) : typeof v === 'number' ? num(v) : /_at$/.test(k) ? date(v) : String(v);
  return (
    <main className="page">
      <h1>{t('rep.title')}</h1>
      <div className="chips">{TABS.map((x) => <button key={x.key} className="chip" aria-pressed={tab === x.key} onClick={() => setTab(x.key)} data-testid={`tab-${x.key}`}>{t(x.label)}</button>)}</div>
      <p className="muted small">{t('rep.rules')}</p>
      {tab === 'sales-by-period' ? <PeriodReport /> : (
        <>
          <div className="card form-grid" style={{ marginBottom: 12 }}>
            <label className="field"><span>{t('common.from')}</span><input className="input" type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></label>
            <label className="field"><span>{t('common.to')}</span><input className="input" type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} /></label>
            <div className="field"><span>&nbsp;</span><a className="btn" href={`/api/admin/reports/${tab}?${qs}&format=csv`} data-testid="export-csv"><Icon name="download" />{t('common.export')}</a></div>
          </div>
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
                <table className="table stack-mobile" data-testid="report-table">
                  <thead><tr>{Object.keys(rows[0]).filter((k) => !/(_id|^id)$/.test(k)).map((k) => <th key={k} className={typeof rows[0][k] === 'number' ? 'num' : ''}>{k.replace(/_/g, ' ')}</th>)}</tr></thead>
                  <tbody>{rows.map((r, i) => (
                    <tr key={i}>{Object.keys(r).filter((k) => !/(_id|^id)$/.test(k)).map((k) => <td key={k} className={typeof r[k] === 'number' ? 'num' : ''}>{fmt(k, r[k])}</td>)}</tr>
                  ))}</tbody>
                </table>
              </div>
            )
          )}
        </>
      )}
    </main>
  );
}
