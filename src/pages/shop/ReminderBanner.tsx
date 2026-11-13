import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { useI18n } from '../../i18n';
import { Icon } from '../../components/Icon';
import type { MessageKey } from '../../i18n/en';

export interface Notification { id: string; kind: string; data: any; link: string | null; read_at: string | null; created_at: string }

export function reminderText(t: ReturnType<typeof useI18n>['t'], n: Notification) {
  const day = t(`weekday.${n.data?.weekday ?? 1}` as MessageKey);
  if (n.data?.last_order_weekday === n.data?.weekday) return t('notif.reorder', { biz: n.data?.business_name ?? 'KHAN G', day });
  return t('notif.reorderUsual', { day });
}

/** Shows this week's unread in-app reorder reminder at the top of the catalogue. */
export function ReminderBanner({ onRepeat }: { onRepeat: () => void }) {
  const { t } = useI18n();
  const [n, setN] = useState<Notification | null>(null);
  useEffect(() => {
    api<{ notifications: Notification[] }>('/notifications')
      .then((r) => setN(r.notifications.find((x) => x.kind === 'reorder_reminder' && !x.read_at) ?? null))
      .catch(() => {});
  }, []);
  if (!n) return null;
  const dismiss = () => {
    setN(null);
    api(`/notifications/${n.id}/read`, { method: 'POST' }).then(() => window.dispatchEvent(new Event('kg:notifications'))).catch(() => {});
  };
  return (
    <div className="reminder-banner" role="status" data-testid="reminder-banner">
      <Icon name="bell" />
      <div className="grow">
        <div style={{ fontWeight: 700 }}>{reminderText(t, n)}</div>
        <div className="row wrap" style={{ marginTop: 8 }}>
          <button className="btn btn-primary btn-sm" onClick={() => { dismiss(); onRepeat(); }}><Icon name="repeat" size={18} />{t('cat.repeatLast')}</button>
          <button className="btn btn-sm" onClick={dismiss}>{t('common.close')}</button>
        </div>
      </div>
    </div>
  );
}
