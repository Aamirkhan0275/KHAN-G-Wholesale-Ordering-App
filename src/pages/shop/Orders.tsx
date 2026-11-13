import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useI18n } from '../../i18n';
import { useApi } from '../../lib/useApi';
import { Icon } from '../../components/Icon';
import { Empty, ErrorBox, Spinner, StatusBadge } from '../../components/ui';

export default function Orders() {
  const { t, date, num, money } = useI18n();
  const [days, setDays] = useState(15);
  const { data, error, loading, reload } = useApi<{ orders: any[] }>(`/shop/orders?days=${days}`);
  return (
    <main className="page narrow">
      <div className="page-title row between"><h1>{t('orders.title')}</h1><span className="badge badge-muted">{t('orders.last15', { n: days })}</span></div>
      <ErrorBox error={error} onRetry={reload} />
      {loading && !data && <Spinner />}
      {data && data.orders.length === 0 && <Empty icon="list" action={<Link to="/" className="btn btn-primary">{t('cart.browse')}</Link>}>{t('orders.empty', { n: days })}</Empty>}
      {data && data.orders.length > 0 && (
        <div className="list" data-testid="orders-list">
          {data.orders.map((o) => (
            <Link to={`/orders/${o.id}`} className="list-item" key={o.id} data-testid="order-row">
              <div className="grow stack-sm" style={{ gap: 2 }}>
                <div className="row between wrap"><span className="title mono">{o.ref}</span><StatusBadge status={o.status} /></div>
                <div className="sub">{date(o.submitted_at, true)} · {t('orders.items', { n: num(o.item_count) })} · {t('units.units', { n: num(o.total_approved_qty ?? o.total_requested_qty) })}
                  {o.approved_total != null ? ` · ${money(o.approved_total)}` : o.requested_total != null ? ` · ${money(o.requested_total)}` : ''}</div>
                <div className="row wrap" style={{ gap: 6 }}>
                  {o.has_changes && <span className="badge badge-warn"><Icon name="alert" />{t('orders.changed')}</span>}
                  {o.invoice_id && <span className="badge badge-info"><Icon name="file" />{t('orders.invoice')}</span>}
                </div>
              </div>
              <Icon name="chev" className="chev" />
            </Link>
          ))}
        </div>
      )}
      {days < 90 && <button className="btn btn-block" style={{ marginTop: 12 }} onClick={() => setDays(90)}>{t('orders.showOlder')}</button>}
    </main>
  );
}
