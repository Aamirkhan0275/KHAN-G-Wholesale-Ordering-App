import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useI18n } from '../../i18n';
import { useApi } from '../../lib/useApi';
import { imageUrl } from '../../lib/api';
import { Icon } from '../../components/Icon';
import { Empty, ErrorBox, Spinner } from '../../components/ui';

export function StockBadge({ p }: { p: any }) {
  const { num } = useI18n();
  if (p.stock_qty <= 0) return <span className="badge badge-bad"><Icon name="ban" />{num(p.stock_qty)}</span>;
  if (p.stock_qty <= p.low_stock_threshold) return <span className="badge badge-warn"><Icon name="alert" />{num(p.stock_qty)}</span>;
  return <span className="badge badge-ok"><Icon name="check" />{num(p.stock_qty)}</span>;
}

export default function Products() {
  const { t, pick, money, num } = useI18n();
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState(params.get('q') ?? '');
  const filter = params.get('filter') ?? 'all';
  const category = params.get('category') ?? '';
  const cats = useApi<{ categories: any[] }>('/admin/categories');
  const { data, error, loading, reload } = useApi<{ products: any[] }>(`/admin/products?filter=${filter}&q=${encodeURIComponent(params.get('q') ?? '')}${category ? `&category=${category}` : ''}`);
  const set = (k: string, v: string) => { const p = new URLSearchParams(params); if (v && v !== 'all') p.set(k, v); else p.delete(k); setParams(p, { replace: true }); };
  return (
    <main className="page">
      <div className="page-title row between"><h1>{t('nav.products')}</h1><Link to="/admin/products/new" className="btn btn-primary" data-testid="add-product"><Icon name="plus" />{t('ap.add')}</Link></div>
      <form className="search" onSubmit={(e) => { e.preventDefault(); set('q', q); }}>
        <Icon name="search" /><input className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)} onBlur={() => set('q', q)} placeholder={t('cat.search')} aria-label={t('common.search')} />
      </form>
      <div className="chips">
        {['all', 'active', 'inactive', 'low', 'out', 'archived'].map((f) => (
          <button key={f} className="chip" aria-pressed={filter === f} onClick={() => set('filter', f)}>{f === 'all' ? t('common.all') : t(`ap.filter.${f}` as any)}</button>
        ))}
        <select className="input" style={{ width: 'auto', minHeight: 42 }} value={category} onChange={(e) => set('category', e.target.value)} aria-label={t('ap.category')}>
          <option value="">{t('ap.category')}: {t('common.all')}</option>
          {cats.data?.categories.map((c) => <option key={c.id} value={c.id}>{pick(c.name_en, c.name_ur)}</option>)}
        </select>
      </div>
      <ErrorBox error={error} onRetry={reload} />
      {loading && !data && <Spinner />}
      {data && <p className="muted small">{t('ap.count', { n: num(data.products.length) })}</p>}
      {data && data.products.length === 0 && <Empty>{t('ap.empty')}</Empty>}
      {data && data.products.length > 0 && (
        <div className="table-wrap">
          <table className="table stack-mobile" data-testid="products-table">
            <thead><tr><th></th><th>{t('ap.sku')}</th><th>{t('ap.nameEn')}</th><th>{t('ap.category')}</th><th className="num">{t('ap.price')}</th><th>{t('ap.stock')}</th><th>{t('common.status')}</th></tr></thead>
            <tbody>
              {data.products.map((p) => (
                <tr key={p.id} className="clickable" onClick={() => nav(`/admin/products/${p.id}`)}>
                  <td>{p.image_id ? <img src={imageUrl(p.image_id)!} className="thumb" style={{ width: 44, height: 44 }} alt="" loading="lazy" /> : <div className="thumb" style={{ width: 44, height: 44 }} />}</td>
                  <td className="mono">{p.sku}</td>
                  <td><b>{p.name_en}</b>{p.name_ur && <div className="muted small" lang="ur" dir="rtl">{p.name_ur}</div>}</td>
                  <td>{p.category_name ?? '—'}</td>
                  <td className="num">{money(p.price)}{!p.show_price && <div className="muted small">🔒</div>}</td>
                  <td><StockBadge p={p} /></td>
                  <td>{p.archived_at ? <span className="badge badge-muted">{t('ap.filter.archived')}</span> : p.is_active ? <span className="badge badge-ok"><Icon name="check" />{t('ap.filter.active')}</span> : <span className="badge badge-muted"><Icon name="ban" />{t('ap.filter.inactive')}</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
