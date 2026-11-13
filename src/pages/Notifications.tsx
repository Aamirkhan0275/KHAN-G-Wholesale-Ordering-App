import { Link, useNavigate } from 'react-router-dom';
import { useI18n } from '../i18n';
import { useApi } from '../lib/useApi';
import { api } from '../lib/api';
import { Icon } from '../components/Icon';
import { Empty, ErrorBox, Spinner } from '../components/ui';
import { reminderText, type Notification } from './shop/ReminderBanner';
import type { MessageKey } from '../i18n/en';

export default function Notifications() {
  const { t, date, money } = useI18n();
  const nav = useNavigate();
  const { data, error, loading, reload } = useApi<{ notifications: Notification[] }>('/notifications');
  const text = (n: Notification) => {
    switch (n.kind) {
      case 'reorder_reminder': return reminderText(t, n);
      case 'order_status': return t('notif.order_status', { ref: n.data.ref, status: t(`status.${n.data.status}` as MessageKey) }) + (n.data.note ? ` — ${n.data.note}` : '');
      case 'invoice': return t('notif.invoice', { no: n.data.invoice_no, ref: n.data.ref });
      case 'payment': return t('notif.payment', { amount: money(n.data.amount), balance: money(n.data.balance) });
      default: return n.kind;
    }
  };
  const open = async (n: Notification) => {
    if (!n.read_at) await api(`/notifications/${n.id}/read`, { method: 'POST' }).catch(() => {});
    window.dispatchEvent(new Event('kg:notifications'));
    nav(n.kind === 'invoice' && n.data.invoice_id ? `/invoices/${n.data.invoice_id}` : n.link ?? '/');
  };
  return (
    <main className="page narrow">
      <div className="page-title row between">
        <h1>{t('notif.title')}</h1>
        <button className="btn btn-sm btn-ghost" onClick={async () => { await api('/notifications/read-all', { method: 'POST' }).catch(() => {}); window.dispatchEvent(new Event('kg:notifications')); void reload(); }}>{t('notif.markAll')}</button>
      </div>
      <ErrorBox error={error} onRetry={reload} />
      {loading && !data && <Spinner />}
      {data && data.notifications.length === 0 && <Empty icon="bell" action={<Link className="btn" to="/">{t('cart.browse')}</Link>}>{t('notif.empty')}</Empty>}
      {data && data.notifications.length > 0 && (
        <div className="list">
          {data.notifications.map((n) => (
            <button className="list-item" key={n.id} onClick={() => open(n)} data-testid={`notif-${n.kind}`} style={n.read_at ? undefined : { background: 'var(--brand-soft)' }}>
              <Icon name={n.kind === 'reorder_reminder' ? 'repeat' : n.kind === 'invoice' ? 'file' : n.kind === 'payment' ? 'money' : 'list'} />
              <div className="grow"><div style={{ fontWeight: n.read_at ? 500 : 800 }}>{text(n)}</div><div className="sub">{date(n.created_at, true)}</div></div>
              <Icon name="chev" className="chev" />
            </button>
          ))}
        </div>
      )}
    </main>
  );
}
