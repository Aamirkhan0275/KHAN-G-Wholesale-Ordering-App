import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useI18n } from '../../i18n';
import { useSession } from '../../lib/session';
import { api } from '../../lib/api';
import { Icon } from '../../components/Icon';
import { Spinner, StatusBadge } from '../../components/ui';
import { openWhatsApp, orderWhatsAppUrl } from './whatsapp';

export default function OrderDone() {
  const { id } = useParams();
  const { t, num } = useI18n();
  const { settings, lang } = useSession();
  const [order, setOrder] = useState<any>(() => { try { return JSON.parse(sessionStorage.getItem(`kg.order.${id}`) ?? 'null'); } catch { return null; } });
  useEffect(() => { api<{ order: any }>(`/shop/orders/${id}`).then((r) => setOrder(r.order)).catch(() => {}); }, [id]);
  if (!order) return <main className="page narrow"><Spinner /></main>;
  const wa = orderWhatsAppUrl(order, (lang === 'ur' && settings?.business_name_ur) || settings?.business_name || 'KHAN G', settings?.business_whatsapp ?? null, lang);
  const units = order.items?.reduce((s: number, i: any) => s + i.requested_qty, 0) ?? order.total_requested_qty;
  return (
    <main className="page narrow">
      <div className="card center stack" style={{ alignItems: 'center' }}>
        <div style={{ width: 84, height: 84, borderRadius: '50%', background: 'var(--ok-soft)', color: 'var(--ok)', display: 'grid', placeItems: 'center' }}><Icon name="check" size={48} /></div>
        <h1 style={{ margin: 0 }}>{t('done.title')}</h1>
        <div className="muted">{t('done.ref')}</div>
        <div className="mono" style={{ fontSize: '1.6rem', fontWeight: 900 }} data-testid="order-ref">{order.ref}</div>
        <StatusBadge status={order.status} />
        <div className="muted">{t('units.items', { n: num(order.items?.length ?? order.item_count) })} · {t('units.units', { n: num(units) })}</div>
        <p style={{ margin: 0 }}>{t('done.next')}</p>
      </div>
      <div className="stack" style={{ marginTop: 14 }}>
        {wa.url ? (
          <>
            <button className="btn btn-wa btn-lg btn-block" onClick={() => openWhatsApp(order.id, wa.url!)} data-testid="send-wa" data-href={wa.url}>
              <Icon name="whatsapp" size={28} />{t('done.sendWa')}
            </button>
            <p className="muted small center" style={{ margin: 0 }}>{t('done.waNote')}</p>
          </>
        ) : <div className="warn-box"><Icon name="alert" />{t('done.waMissing')}</div>}
        <div className="info-box"><Icon name="check" />{t('done.saved')}</div>
        <div className="row">
          <Link to={`/orders/${order.id}`} className="btn btn-block grow">{t('done.viewOrder')}</Link>
          <Link to="/" className="btn btn-soft btn-block grow">{t('done.newOrder')}</Link>
        </div>
      </div>
    </main>
  );
}
