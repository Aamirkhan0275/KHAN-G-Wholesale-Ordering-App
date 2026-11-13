import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useI18n } from '../../i18n';
import { useApi } from '../../lib/useApi';
import { ErrorBox, Spinner } from '../../components/ui';
import { MovementTable, StockModal } from './ProductEdit';
import { StockBadge } from './Products';

export default function Stock() {
  const { t, pick } = useI18n();
  const low = useApi<{ rows: any[] }>('/admin/reports/low-stock');
  const moves = useApi<{ movements: any[] }>('/admin/stock/movements');
  const [adjust, setAdjust] = useState<any | null>(null);
  return (
    <main className="page">
      <div className="page-title row between"><h1>{t('nav.stock')}</h1><a className="btn btn-sm" href="/api/admin/reports/low-stock?format=csv">{t('common.export')}</a></div>
      <p className="muted">{t('ao.stockRule')}</p>
      <h2>{t('dash.lowStock')}</h2>
      <ErrorBox error={low.error} onRetry={low.reload} />
      {low.loading && !low.data && <Spinner />}
      {low.data && (
        <div className="table-wrap">
          <table className="table stack-mobile" data-testid="low-stock">
            <thead><tr><th>{t('ap.sku')}</th><th>{t('common.items')}</th><th>{t('ap.category')}</th><th>{t('ap.stock')}</th><th className="num">{t('ap.lowThreshold')}</th><th></th></tr></thead>
            <tbody>{low.data.rows.map((p) => (
              <tr key={p.id}><td className="mono">{p.sku}</td><td><Link to={`/admin/products/${p.id}`}>{pick(p.product, p.name_ur)}</Link></td><td>{p.category}</td><td><StockBadge p={p} /></td><td className="num">{p.low_stock_threshold}</td>
                <td><button className="btn btn-sm btn-soft" onClick={() => setAdjust({ ...p, name_en: p.product })}>{t('ap.adjustStock')}</button></td></tr>
            ))}</tbody>
          </table>
        </div>
      )}
      <h2 style={{ marginTop: 18 }}>{t('ap.movements')}</h2>
      {moves.data && <MovementTable rows={moves.data.movements} showProduct />}
      {adjust && <StockModal product={adjust} onClose={() => setAdjust(null)} onDone={() => { setAdjust(null); void low.reload(); void moves.reload(); }} />}
    </main>
  );
}
