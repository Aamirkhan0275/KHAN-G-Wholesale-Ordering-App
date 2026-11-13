import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useI18n } from '../../i18n';
import { api, ApiFailure } from '../../lib/api';
import { normalizePhone } from '../../../shared/phone';
import { Icon } from '../../components/Icon';
import { Field, useToast } from '../../components/ui';

function randomPin() {
  const a = new Uint32Array(1); crypto.getRandomValues(a);
  return String(100000 + (a[0] % 900000));
}

export default function ShopNew() {
  const { t, te } = useI18n();
  const nav = useNavigate();
  const toast = useToast();
  const [f, setF] = useState({ full_name: '', phone: '', shop_name: '', address: '', location_note: '', language: 'ur', password: randomPin(), activate: true, must_change_password: true, opening_balance: '',
    city: '', area: '', whatsapp_phone: '', alternate_phone: '', email: '', cnic: '', ntn: '', shop_type: '' });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const phoneOk = !f.phone || normalizePhone(f.phone).ok;
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!normalizePhone(f.phone).ok) { setErr('invalid_phone'); return; }
    setBusy(true); setErr(null);
    try {
      const extra = Object.fromEntries(['city', 'area', 'whatsapp_phone', 'alternate_phone', 'email', 'cnic', 'ntn', 'shop_type'].map((k) => [k, (f as any)[k] || null]));
      const r = await api<{ shop: any }>('/admin/shops', { body: { ...f, ...extra, address: f.address || null, location_note: f.location_note || null, opening_balance: f.opening_balance ? Number(f.opening_balance) : undefined } });
      toast(t('common.saved'));
      nav(`/admin/shops/${r.shop.id}`, { replace: true });
    } catch (e2) { setErr(e2 instanceof ApiFailure ? e2.code : 'network'); }
    finally { setBusy(false); }
  };
  return (
    <main className="page narrow">
      <div className="page-title"><Link to="/admin/shops" className="btn btn-ghost" aria-label={t('common.back')}><Icon name="back" className="flip-rtl" /></Link><h1>{t('as.new')}</h1></div>
      <form className="card stack" onSubmit={submit}>
        <Field label={t('as.ownerName')}><input className="input" required minLength={2} value={f.full_name} onChange={set('full_name')} name="full_name" /></Field>
        <Field label={t('auth.phone')} hint={phoneOk ? t('auth.phoneHint') : t('auth.err.invalid_phone')}>
          <input className="input ltr" dir="ltr" type="tel" required value={f.phone} onChange={set('phone')} aria-invalid={!phoneOk} name="phone" /></Field>
        <Field label={t('as.shopName')}><input className="input" required minLength={2} value={f.shop_name} onChange={set('shop_name')} name="shop_name" /></Field>
        <Field label={`${t('as.address')} (${t('common.optional')})`}><input className="input" value={f.address} onChange={set('address')} /></Field>
        <Field label={`${t('as.locationNote')} (${t('common.optional')})`}><input className="input" value={f.location_note} onChange={set('location_note')} /></Field>
        <div className="form-grid">
          <Field label={`${t('cust.city')} (${t('common.optional')})`}><input className="input" value={f.city} onChange={set('city')} name="city" /></Field>
          <Field label={`${t('cust.area')} (${t('common.optional')})`}><input className="input" value={f.area} onChange={set('area')} name="area" /></Field>
        </div>
        <details className="card flat"><summary style={{ fontWeight: 700, cursor: 'pointer', minHeight: 40 }}>{t('cust.more')}</summary>
          <div className="form-grid" style={{ marginTop: 10 }}>
            <Field label={t('cust.whatsapp')}><input className="input ltr" dir="ltr" type="tel" value={f.whatsapp_phone} onChange={set('whatsapp_phone')} name="whatsapp_phone" /></Field>
            <Field label={t('cust.altPhone')}><input className="input ltr" dir="ltr" type="tel" value={f.alternate_phone} onChange={set('alternate_phone')} name="alternate_phone" /></Field>
            <Field label={t('cust.email')}><input className="input ltr" dir="ltr" type="email" value={f.email} onChange={set('email')} name="email" /></Field>
            <Field label={t('cust.cnic')}><input className="input ltr" dir="ltr" inputMode="numeric" placeholder="17301-1234567-1" value={f.cnic} onChange={set('cnic')} name="cnic" /></Field>
            <Field label={t('cust.ntn')}><input className="input ltr" dir="ltr" value={f.ntn} onChange={set('ntn')} name="ntn" /></Field>
            <Field label={t('cust.shopType')}><input className="input" value={f.shop_type} onChange={set('shop_type')} name="shop_type" /></Field>
          </div>
        </details>
        <Field label={t('acc.language')}><select className="input" value={f.language} onChange={set('language')}><option value="ur">اردو</option><option value="en">English</option></select></Field>
        <Field label={t('as.tempPassword')}><input className="input mono" dir="ltr" required minLength={6} value={f.password} onChange={set('password')} name="password" /></Field>
        <Field label={`${t('as.openingBalance')} (${t('common.optional')})`}><input className="input" type="number" min={0} value={f.opening_balance} onChange={set('opening_balance')} /></Field>
        <label className="check"><input type="checkbox" checked={f.activate} onChange={set('activate')} />{t('as.activateNow')}</label>
        <label className="check"><input type="checkbox" checked={f.must_change_password} onChange={set('must_change_password')} />{t('as.mustChange')}</label>
        {err && <div className="error-box" role="alert"><Icon name="alert" />{te(err, ['as.err', 'auth.err'])}</div>}
        <button className="btn btn-primary btn-lg" disabled={busy} data-testid="create-shop">{t('common.save')}</button>
      </form>
    </main>
  );
}
