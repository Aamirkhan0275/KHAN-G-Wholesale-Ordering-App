import { useEffect, useState, type FormEvent } from 'react';
import { useI18n } from '../../i18n';
import { useApi } from '../../lib/useApi';
import { api, ApiFailure } from '../../lib/api';
import { useSession } from '../../lib/session';
import { Icon } from '../../components/Icon';
import { Field, Spinner, Switch, useToast } from '../../components/ui';
import { ContactCard } from '../../components/ContactCard';

export default function Settings() {
  const { t, te } = useI18n();
  const toast = useToast();
  const { refresh } = useSession();
  const { data } = useApi<{ settings: any }>('/admin/settings');
  const [s, setS] = useState<any>(null);
  const [err, setErr] = useState<ApiFailure | null>(null);
  useEffect(() => { if (data) setS({ ...data.settings }); }, [data]);
  if (!s) return <main className="page narrow"><Spinner /></main>;
  const set = (k: string) => (e: any) => setS({ ...s, [k]: e?.target ? e.target.value : e });
  const save = async (e: FormEvent) => {
    e.preventDefault(); setErr(null);
    const keys = ['business_name', 'business_name_ur', 'business_phone', 'business_whatsapp', 'business_address', 'business_email', 'invoice_footer', 'currency', 'show_prices', 'timezone', 'low_stock_default'];
    const body: any = Object.fromEntries(keys.map((k) => [k, s[k] === '' ? null : s[k]]));
    body.business_name = s.business_name; body.currency = String(s.currency).toUpperCase(); body.low_stock_default = Number(s.low_stock_default);
    try { const r = await api<{ settings: any }>('/admin/settings', { method: 'PATCH', body }); setS(r.settings); toast(t('common.saved')); void refresh(); }
    catch (e2) { setErr(e2 instanceof ApiFailure ? e2 : new ApiFailure(0, 'network')); }
  };
  return (
    <main className="page narrow">
      <h1>{t('set.title')}</h1>
      <form className="card stack" onSubmit={save}>
        <h2>{t('set.contactSection')}</h2>
        <p className="muted small" style={{ margin: 0 }}>{t('set.contactHint')}</p>
        <div className="form-grid">
          <Field label={t('set.whatsapp')} hint="0300 1234567 / +92 300 1234567"><input className="input ltr" dir="ltr" type="tel" value={s.business_whatsapp ?? ''} onChange={set('business_whatsapp')} data-testid="set-whatsapp" /></Field>
          <Field label={t('set.phone')}><input className="input ltr" dir="ltr" type="tel" value={s.business_phone ?? ''} onChange={set('business_phone')} data-testid="set-phone" /></Field>
        </div>
        <div><div className="muted small" style={{ fontWeight: 700, marginBottom: 6 }}>{t('set.preview')}</div>
          <ContactCard name={s.business_name} whatsapp={s.business_whatsapp} phone={s.business_phone} compact /></div>
        <hr className="divider" />
        <h2>{t('set.business')}</h2>
        <Field label={t('set.nameEn')}><input className="input" required value={s.business_name ?? ''} onChange={set('business_name')} /></Field>
        <Field label={t('set.nameUr')}><input className="input" dir="rtl" value={s.business_name_ur ?? ''} onChange={set('business_name_ur')} /></Field>
        <Field label={t('set.address')}><input className="input" value={s.business_address ?? ''} onChange={set('business_address')} /></Field>
        <Field label={t('set.email')}><input className="input ltr" dir="ltr" type="email" value={s.business_email ?? ''} onChange={set('business_email')} /></Field>
        <Field label={t('set.footer')}><textarea className="input" value={s.invoice_footer ?? ''} maxLength={300} onChange={set('invoice_footer')} /></Field>
        <div className="form-grid">
          <Field label={t('set.currency')}><input className="input mono" maxLength={3} value={s.currency} onChange={set('currency')} /></Field>
          <Field label={t('set.timezone')}><input className="input mono" value={s.timezone} onChange={set('timezone')} /></Field>
          <Field label={t('set.lowDefault')}><input className="input" type="number" min={0} value={s.low_stock_default} onChange={set('low_stock_default')} /></Field>
        </div>
        <div className="row between"><span style={{ fontWeight: 700 }}>{t('set.showPrices')}</span><Switch checked={!!s.show_prices} onChange={(v) => setS({ ...s, show_prices: v })} label={t('set.showPrices')} /></div>
        {err && <div className="error-box" role="alert"><Icon name="alert" />{te(err.code, ['set.err'])}{err.details?.field ? ` (${err.details.field})` : ''}</div>}
        <button className="btn btn-primary btn-lg" data-testid="save-settings">{t('common.save')}</button>
      </form>
    </main>
  );
}
