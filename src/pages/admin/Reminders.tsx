import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useI18n } from '../../i18n';
import { useApi } from '../../lib/useApi';
import { api } from '../../lib/api';
import { Icon } from '../../components/Icon';
import { ErrorBox, Field, Spinner, Switch, useToast } from '../../components/ui';
import type { MessageKey } from '../../i18n/en';

export default function Reminders() {
  const { t, date } = useI18n();
  const toast = useToast();
  const settings = useApi<{ settings: any }>('/admin/settings');
  const { data, error, loading, reload } = useApi<{ log: any[]; plan: any[] }>('/admin/reminders');
  const [s, setS] = useState<any>(null);
  const [result, setResult] = useState<any>(null);
  useEffect(() => { if (settings.data) setS(settings.data.settings); }, [settings.data]);
  const save = async (patch: any) => {
    try { const r = await api<{ settings: any }>('/admin/settings', { method: 'PATCH', body: patch }); setS(r.settings); toast(t('common.saved')); }
    catch { toast(t('common.error'), 'bad'); }
  };
  const runNow = async () => {
    const r = await api('/admin/reminders/run', { body: {} }).catch(() => null);
    if (!r) { toast(t('common.error'), 'bad'); return; }
    setResult(r); void reload();
  };
  if (!s) return <main className="page"><Spinner /></main>;
  return (
    <main className="page">
      <h1>{t('rem.title')}</h1>
      <div className="info-box" style={{ marginBottom: 12 }}><Icon name="bell" />{t('rem.honest')}</div>
      <div className="card stack">
        <div className="row between"><span style={{ fontWeight: 700 }}>{t('rem.enabled')}</span><Switch checked={s.reminders_enabled} label={t('rem.enabled')} onChange={(v) => save({ reminders_enabled: v })} /></div>
        <div className="form-grid">
          <Field label={`${t('rem.time')} (${s.timezone})`}><input className="input" type="time" value={s.reminder_time} onChange={(e) => setS({ ...s, reminder_time: e.target.value })} onBlur={() => save({ reminder_time: s.reminder_time })} data-testid="reminder-time" /></Field>
          <Field label={t('rem.rule')}><select className="input" value={s.reminder_rule} onChange={(e) => save({ reminder_rule: e.target.value })}>
            <option value="latest_order">{t('rem.rule.latest_order')}</option><option value="fixed">{t('rem.rule.fixed')}</option></select></Field>
          {s.reminder_rule === 'fixed' && <Field label={t('rem.defaultDay')}><select className="input" value={s.reminder_default_weekday ?? 1} onChange={(e) => save({ reminder_default_weekday: Number(e.target.value) })}>
            {[0, 1, 2, 3, 4, 5, 6].map((d) => <option key={d} value={d}>{t(`weekday.${d}` as MessageKey)}</option>)}</select></Field>}
        </div>
        <button className="btn btn-soft" onClick={runNow} data-testid="run-reminders"><Icon name="refresh" />{t('rem.runNow')}</button>
        {result && <div className="ok-box" data-testid="run-result">{t('rem.ranResult', { sent: result.sent, skipped: Object.values(result.skipped).reduce((a: number, b: any) => a + Number(b), 0), notDue: result.not_due })} ({result.cycle})</div>}
      </div>
      <ErrorBox error={error} onRetry={reload} />
      {loading && !data && <Spinner />}
      {data && (
        <div className="grid cols-2" style={{ marginTop: 14 }}>
          <section>
            <h2>{t('rem.plan')}</h2>
            <div className="list">{data.plan.map((p) => {
              const day = p.reminder_weekday ?? (s.reminder_rule === 'fixed' ? s.reminder_default_weekday : p.last_order_dow);
              return (
                <Link key={p.id} to={`/admin/shops/${p.id}`} className="list-item">
                  <div className="grow"><div className="title">{p.name}</div><div className="sub">{p.last_order_at ? `${t('as.lastOrder')}: ${date(p.last_order_at)}` : t('rem.noDay')}</div></div>
                  {!p.reminder_enabled || p.reminders_opt_out ? <span className="badge badge-muted"><Icon name="ban" />{p.reminders_opt_out ? t('rem.status.skipped_opted_out') : t('rem.status.skipped_disabled')}</span>
                    : day === null || day === undefined ? <span className="badge badge-muted">{t('rem.noDay')}</span>
                    : <span className="badge badge-info"><Icon name="clock" />{t(`weekday.${day}` as MessageKey)}{p.reminder_weekday !== null ? ' *' : ''}</span>}
                </Link>
              );
            })}</div>
          </section>
          <section>
            <h2>{t('rem.history')}</h2>
            {data.log.length === 0 ? <p className="muted">{t('rem.empty')}</p> : (
              <div className="table-wrap"><table className="table" data-testid="reminder-log">
                <thead><tr><th>{t('common.date')}</th><th>{t('acc.shop')}</th><th>{t('common.status')}</th></tr></thead>
                <tbody>{data.log.map((r) => <tr key={r.id}><td>{date(r.created_at, true)}<div className="muted small mono">{r.cycle_key}</div></td><td>{r.shop}</td>
                  <td>{t(`rem.status.${r.status}` as MessageKey)}{r.read_at && <div className="muted small">{t('rem.read')}</div>}</td></tr>)}</tbody>
              </table></div>
            )}
          </section>
        </div>
      )}
    </main>
  );
}
