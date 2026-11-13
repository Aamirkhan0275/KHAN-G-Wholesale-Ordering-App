import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useI18n } from '../../i18n';
import { useSession } from '../../lib/session';
import { useCart } from '../../lib/cart';
import { useCatalogue } from '../../lib/catalogue';
import { useApi } from '../../lib/useApi';
import { api, imageUrl } from '../../lib/api';
import { Icon } from '../../components/Icon';
import { ErrorBox, LineBadge, Spinner, StatusBadge, useConfirm, useToast } from '../../components/ui';
import { openWhatsApp, orderWhatsAppUrl } from './whatsapp';
import { repeatOrderIntoCart } from './repeat';
import type { MessageKey } from '../../i18n/en';

const STEPS = ['submitted', 'checking', 'confirmed', 'delivered'];

export default function OrderDetail() {
  const { id } = useParams();
  const { t, pick, date, money, num } = useI18n();
  const { settings, lang } = useSession();
  const { data, error, loading, reload } = useApi<{ order: any }>(`/shop/orders/${id}`);
  const cat = useCatalogue();
  const cart = useCart();
  const confirm = useConfirm();
  const toast = useToast();
  const nav = useNavigate();
  const [busy, setBusy] = useState(false);
  if (loading && !data) return <main className="page narrow"><Spinner /></main>;
  if (error) return <main className="page narrow"><ErrorBox error={error} onRetry={reload} /></main>;
  const o = data!.order;
  const wa = orderWhatsAppUrl(o, (lang === 'ur' && settings?.business_name_ur) || settings?.business_name || 'KHAN G', settings?.business_whatsapp ?? null, lang);
  const stepIdx = o.status === 'cancelled' ? -1 : Math.max(STEPS.indexOf(o.status === 'needs_confirmation' ? 'checking' : o.status === 'ready' ? 'confirmed' : o.status), 0);
  const byId = new Map<string, any>(o.items.map((i: any) => [i.id, i]));

  const cancel = async () => {
    if (!(await confirm({ message: t('orders.cancelConfirm'), danger: true }))) return;
    setBusy(true);
    try { await api(`/shop/orders/${o.id}/cancel`, { method: 'POST' }); await reload(); }
    catch { toast(t('common.error'), 'bad'); } finally { setBusy(false); }
  };
  const repeat = async () => {
    if (!cat.data) return;
    const r = await repeatOrderIntoCart(cat.data.products, cart, o.id).catch(() => null);
    if (!r) { toast(t('common.error'), 'bad'); return; }
    toast(t('cart.repeatAdded', { n: r.added }));
    if (r.skipped) toast(t('cart.repeatSkipped', { n: r.skipped }), 'bad');
    nav('/cart');
  };

  return (
    <main className="page narrow">
      <div className="page-title"><Link to="/orders" className="btn btn-ghost" aria-label={t('common.back')}><Icon name="back" className="flip-rtl" /></Link><h1 className="mono">{o.ref}</h1></div>
      <div className="card stack-sm">
        <div className="row between wrap"><StatusBadge status={o.status} /><span className="muted small">{date(o.submitted_at, true)}</span></div>
        {stepIdx >= 0 && <div className="progress-steps" aria-hidden="true">{STEPS.map((s, i) => <div key={s} className={i <= stepIdx ? 'on' : ''} />)}</div>}
        {o.customer_note && <div className="small"><b>{t('orders.yourNote')}:</b> {o.customer_note}</div>}
        {o.whatsapp_opened_at && <div className="small muted"><Icon name="whatsapp" size={16} /> {t('orders.waOpened')} · {date(o.whatsapp_opened_at, true)}</div>}
      </div>

      <h2 style={{ marginTop: 16 }}>{t('common.items')}</h2>
      <div className="list">
        {o.items.map((i: any) => {
          const changed = i.approved_qty !== null && i.approved_qty !== i.requested_qty;
          const img = imageUrl(i.image_id);
          return (
            <div className="list-item" key={i.id} data-testid="order-line">
              {img ? <img className="thumb" src={img} alt="" /> : <div className="thumb" />}
              <div className="grow">
                <div className="title">{pick(i.name_en_snapshot, i.name_ur_snapshot)}</div>
                {i.substitute_for_item_id && byId.get(i.substitute_for_item_id) && (
                  <div className="sub">{t('orders.substituteFor', { name: pick(byId.get(i.substitute_for_item_id).name_en_snapshot, byId.get(i.substitute_for_item_id).name_ur_snapshot) })}</div>
                )}
                <div className="sub">
                  {i.line_status !== 'added' && <>{t('orders.requested')}: <b className="num">{num(i.requested_qty)}</b> {pick(i.unit_label_en_snapshot, i.unit_label_ur_snapshot)}</>}
                  {i.approved_qty !== null && <> · {t('orders.approved')}: <b className="num" style={changed ? { color: 'var(--warn)' } : undefined}>{num(i.approved_qty)}</b></>}
                  {i.unit_price_snapshot != null && <> · {money(i.unit_price_snapshot)}</>}
                </div>
                {i.customer_note && <div className="sub" style={{ color: 'var(--warn)' }}>{i.customer_note}</div>}
              </div>
              <LineBadge status={i.line_status} />
            </div>
          );
        })}
      </div>
      <div className="card" style={{ marginTop: 12 }}>
        <div className="totals">
          <span>{t('cart.totalUnits')}</span><span className="num">{num(o.total_approved_qty ?? o.total_requested_qty)}</span>
          {(o.approved_total ?? o.requested_total) != null && <><span className="strong">{t('common.total')}</span><span className="strong num">{money(o.approved_total ?? o.requested_total)}</span></>}
        </div>
      </div>

      <div className="stack" style={{ marginTop: 14 }}>
        {o.invoice && <Link to={`/invoices/${o.invoice.id}`} className="btn btn-primary btn-lg btn-block"><Icon name="file" />{t('orders.invoice')} {o.invoice.invoice_no}</Link>}
        {wa.url && o.status !== 'cancelled' && <button className="btn btn-wa btn-block" onClick={() => openWhatsApp(o.id, wa.url!)}><Icon name="whatsapp" />{t('orders.resendWa')}</button>}
        <button className="btn btn-soft btn-block" onClick={repeat} disabled={!cat.data}><Icon name="repeat" />{t('orders.repeat')}</button>
        {o.status === 'submitted' && <button className="btn btn-danger btn-block" onClick={cancel} disabled={busy}>{t('orders.cancel')}</button>}
      </div>

      <h2 style={{ marginTop: 18 }}>{t('orders.timeline')}</h2>
      <ol className="timeline card">
        {o.history.map((h: any, i: number) => (
          <li key={i}><b>{t(`status.${h.to_status}` as MessageKey)}</b><div className="muted small">{date(h.changed_at, true)}</div>{h.note && <div className="small">{h.note}</div>}</li>
        ))}
      </ol>
    </main>
  );
}
