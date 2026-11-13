import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useI18n } from '../../i18n';
import { useApi } from '../../lib/useApi';
import { api, ApiFailure } from '../../lib/api';
import { formatPhone } from '../../../shared/phone';
import { Icon } from '../../components/Icon';
import { ErrorBox, Field, Modal, Spinner, StatusBadge, Switch, useConfirm, useToast } from '../../components/ui';
import { LedgerTable } from '../shop/Account';
import { ShopStatus } from './Shops';
import type { MessageKey } from '../../i18n/en';

export default function ShopDetail() {
  const { id } = useParams();
  const { t, te, money, date, num } = useI18n();
  const toast = useToast();
  const confirm = useConfirm();
  const [days, setDays] = useState(15);
  const { data, error, loading, reload } = useApi<any>(`/admin/shops/${id}?days=${days}`);
  const ledger = useApi<{ entries: any[]; balance: number }>(`/admin/shops/${id}/ledger`);
  const [modal, setModal] = useState<'payment' | 'adjust' | 'edit' | 'password' | null>(null);
  const [err, setErr] = useState<string | null>(null);

  if (loading && !data) return <main className="page"><Spinner /></main>;
  if (error) return <main className="page"><ErrorBox error={error} onRetry={reload} /></main>;
  const { shop, stats, orders, reminders, admin_details } = data;
  const overLimit = admin_details?.credit_limit != null && stats.balance > admin_details.credit_limit;
  const patch = async (body: any, msg?: string) => {
    if (msg && !(await confirm({ message: msg }))) return;
    setErr(null);
    try { await api(`/admin/shops/${id}`, { method: 'PATCH', body }); toast(t('common.saved')); await reload(); }
    catch (e) { setErr(e instanceof ApiFailure ? e.code : 'network'); }
  };
  const refreshAll = () => { void reload(); void ledger.reload(); };

  return (
    <main className="page">
      <div className="page-title row wrap"><Link to="/admin/shops" className="btn btn-ghost" aria-label={t('common.back')}><Icon name="back" className="flip-rtl" /></Link><h1>{shop.name}</h1><ShopStatus status={shop.status} /></div>
      {err && <div className="error-box" style={{ marginBottom: 10 }}>{te(err, ['as.err', 'auth.err'])}</div>}
      <div className="grid cols-2">
        <div className="card stack-sm">
          <dl className="details" data-testid="customer-details">
            {([
              [t('as.ownerName'), shop.full_name], [t('auth.phone'), formatPhone(shop.phone), true],
              [t('cust.whatsapp'), shop.whatsapp_phone && formatPhone(shop.whatsapp_phone), true], [t('cust.altPhone'), shop.alternate_phone && formatPhone(shop.alternate_phone), true],
              [t('as.address'), shop.address], [t('cust.area'), shop.area], [t('cust.city'), shop.city], [t('as.locationNote'), shop.location_note],
              [t('cust.shopType'), shop.shop_type], [t('cust.email'), shop.email, true], [t('cust.cnic'), shop.cnic, true], [t('cust.ntn'), shop.ntn, true],
              [t('cust.since'), date(shop.created_at)],
            ] as [string, any, boolean?][]).filter(([, v]) => v).map(([k, v, ltr]) => <div key={k}><dt>{k}</dt><dd className={ltr ? 'ltr' : ''}>{v}</dd></div>)}
          </dl>
          {overLimit && <div className="warn-box" data-testid="over-limit"><Icon name="alert" />{t('cust.overLimit')}: {money(stats.balance)} / {money(admin_details.credit_limit)}</div>}
          <div className="muted small">{t('as.lastLogin')}: {shop.last_login_at ? date(shop.last_login_at, true) : t('as.never')}</div>
          <div className="row wrap">
            {shop.status === 'pending' && <button className="btn btn-primary" onClick={() => patch({ status: 'active' })} data-testid="approve-shop"><Icon name="check" />{t('as.approve')}</button>}
            {shop.status === 'active' && <button className="btn btn-danger" onClick={() => patch({ status: 'inactive' }, `${t('as.deactivate')}?`)} data-testid="deactivate-shop">{t('as.deactivate')}</button>}
            {shop.status === 'inactive' && <button className="btn" onClick={() => patch({ status: 'active' })}>{t('as.reactivate')}</button>}
            <button className="btn" onClick={() => setModal('edit')}><Icon name="edit" size={18} />{t('common.edit')}</button>
            <button className="btn" onClick={() => setModal('password')}>{t('as.resetPassword')}</button>
          </div>
        </div>
        <div className="grid cols-2" style={{ gap: 8 }}>
          <div className="stat"><span className="value" style={{ fontSize: '1.3rem', color: ledger.data?.balance ? 'var(--warn)' : undefined }} data-testid="shop-balance">{money(stats.balance)}</span><span className="label">{t('as.balance')}</span></div>
          <div className="stat"><span className="value" style={{ fontSize: '1.3rem' }}>{money(stats.total_purchases)}</span><span className="label">{t('as.totalPurchases')}</span></div>
          <div className="stat"><span className="value">{num(stats.orders_period)}</span><span className="label">{t('as.periodOrders', { n: days })}</span></div>
          <div className="stat"><span className="value" style={{ fontSize: '1.3rem' }}>{money(stats.purchases_period)}</span><span className="label">{t('as.purchases')} ({t('common.days', { n: days })})</span></div>
          <div className="stat"><span className="value">{num(stats.orders_all)}</span><span className="label">{t('as.ordersCount')}</span></div>
          <div className="stat"><span className="value" style={{ fontSize: '1rem' }}>{stats.last_order_at ? date(stats.last_order_at) : t('as.never')}</span><span className="label">{t('as.lastOrder')}</span></div>
        </div>
      </div>

      <section className="section">
        <div className="row between wrap"><h2>{t('nav.adminOrders')}</h2>
          <div className="segmented">{[15, 30, 90].map((d) => <button key={d} aria-pressed={days === d} onClick={() => setDays(d)}>{t('common.days', { n: d })}</button>)}</div></div>
        {orders.length === 0 ? <p className="muted">{t('orders.empty', { n: days })}</p> : (
          <div className="list">{orders.map((o: any) => (
            <Link key={o.id} to={`/admin/orders/${o.id}`} className="list-item"><div className="grow"><span className="title mono">{o.ref}</span><div className="sub">{date(o.submitted_at, true)} · {t('units.items', { n: o.item_count })}</div></div>
              {o.approved_total != null && <b className="num">{money(o.approved_total)}</b>}<StatusBadge status={o.status} admin /></Link>
          ))}</div>
        )}
      </section>

      <section className="section">
        <div className="row between wrap"><h2>{t('as.ledger')}</h2>
          <div className="row wrap">
            <button className="btn btn-primary" onClick={() => setModal('payment')} data-testid="record-payment"><Icon name="money" />{t('as.recordPayment')}</button>
            <button className="btn" onClick={() => setModal('adjust')}>{t('as.addAdjustment')}</button>
            <a className="btn btn-sm" href={`/api/admin/shops/${id}/ledger?format=csv`}>{t('common.export')}</a>
          </div></div>
        {ledger.data && (ledger.data.entries.length ? <LedgerTable entries={ledger.data.entries} money={money} date={date} t={t} /> : <p className="muted">{t('acc.noLedger')}</p>)}
        <p className="muted small">{t('ledger.disclaimer')}</p>
      </section>

      <AdminNotes shopId={id!} initial={admin_details} onSaved={() => { void reload(); toast(t('common.saved')); }} />

      <section className="card stack" style={{ marginTop: 12 }}>
        <h2>{t('as.reminderSettings')}</h2>
        <div className="row between"><span>{t('as.reminderEnabled')}</span><Switch checked={shop.reminder_enabled} label={t('as.reminderEnabled')} onChange={(v) => patch({ reminder_enabled: v })} /></div>
        <Field label={t('as.reminderDay')}>
          <select className="input" value={shop.reminder_weekday ?? ''} onChange={(e) => patch({ reminder_weekday: e.target.value === '' ? null : Number(e.target.value) })} data-testid="reminder-day">
            <option value="">{t('as.reminderAuto')}</option>
            {[0, 1, 2, 3, 4, 5, 6].map((d) => <option key={d} value={d}>{t(`weekday.${d}` as MessageKey)}</option>)}
          </select>
        </Field>
        {shop.reminders_opt_out && <div className="warn-box"><Icon name="alert" />{t('as.optedOut')}</div>}
        {reminders.length > 0 && (
          <div className="list">{reminders.map((r: any, i: number) => <div key={i} className="list-item"><span className="mono">{r.cycle_key}</span><span className="grow">{t(`weekday.${r.weekday}` as MessageKey)}</span><span className="small">{t(`rem.status.${r.status}` as MessageKey)}</span></div>)}</div>
        )}
      </section>

      {modal === 'payment' && <PaymentModal shopId={id!} onClose={() => setModal(null)} onDone={() => { setModal(null); refreshAll(); toast(t('common.saved')); }} />}
      {modal === 'adjust' && <AdjustModal shopId={id!} onClose={() => setModal(null)} onDone={() => { setModal(null); refreshAll(); }} />}
      {modal === 'edit' && <EditModal shop={shop} onClose={() => setModal(null)} onSave={async (b) => { await patch(b); setModal(null); }} />}
      {modal === 'password' && <PasswordModal shopId={id!} onClose={() => setModal(null)} onDone={() => { setModal(null); toast(t('common.saved')); }} />}
    </main>
  );
}

function PaymentModal({ shopId, onClose, onDone }: { shopId: string; onClose: () => void; onDone: () => void }) {
  const { t, te } = useI18n();
  const [f, setF] = useState({ amount: '', payment_method: 'cash', reference: '', note: '', entry_date: '' });
  const [err, setErr] = useState<string | null>(null);
  const submit = async () => {
    setErr(null);
    const amount = Number(f.amount);
    if (!(amount > 0)) { setErr('invalid_input'); return; }
    try { await api(`/admin/shops/${shopId}/payments`, { body: { amount, payment_method: f.payment_method, reference: f.reference || null, note: f.note || null, ...(f.entry_date ? { entry_date: f.entry_date } : {}) } }); onDone(); }
    catch (e) { setErr(e instanceof ApiFailure ? e.code : 'network'); }
  };
  return (
    <Modal title={t('as.recordPayment')} onClose={onClose}>
      <div className="stack">
        <Field label={t('common.amount')}><input className="input" type="number" min={1} step="0.01" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} data-testid="payment-amount" /></Field>
        <Field label={t('as.paymentMethod')}><select className="input" value={f.payment_method} onChange={(e) => setF({ ...f, payment_method: e.target.value })}>
          {['cash', 'bank', 'mobile_wallet', 'cheque', 'other'].map((m) => <option key={m} value={m}>{t(`pay.${m}` as MessageKey)}</option>)}</select></Field>
        <Field label={`${t('common.date')} (${t('common.optional')})`}><input className="input" type="date" value={f.entry_date} onChange={(e) => setF({ ...f, entry_date: e.target.value })} /></Field>
        <Field label={t('as.reference')}><input className="input" value={f.reference} maxLength={80} onChange={(e) => setF({ ...f, reference: e.target.value })} /></Field>
        <Field label={t('common.note')}><input className="input" value={f.note} maxLength={300} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
        {err && <div className="error-box">{te(err)}</div>}
      </div>
      <div className="actions"><button className="btn" onClick={onClose}>{t('common.cancel')}</button><button className="btn btn-primary" onClick={submit} data-testid="payment-save">{t('common.save')}</button></div>
    </Modal>
  );
}

function AdjustModal({ shopId, onClose, onDone }: { shopId: string; onClose: () => void; onDone: () => void }) {
  const { t, te } = useI18n();
  const [f, setF] = useState({ kind: 'adjustment', direction: 'debit', amount: '', note: '' });
  const [err, setErr] = useState<string | null>(null);
  const submit = async () => {
    setErr(null);
    try { await api(`/admin/shops/${shopId}/adjustments`, { body: { ...f, amount: Number(f.amount) } }); onDone(); }
    catch (e) { setErr(e instanceof ApiFailure ? e.code : 'network'); }
  };
  return (
    <Modal title={t('as.addAdjustment')} onClose={onClose}>
      <div className="stack">
        <Field label={t('as.direction')}><select className="input" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>
          <option value="adjustment">{t('ledger.adjustment')}</option><option value="opening_balance">{t('ledger.opening_balance')}</option></select></Field>
        <div className="segmented"><button aria-pressed={f.direction === 'debit'} onClick={() => setF({ ...f, direction: 'debit' })}>{t('as.debit')}</button><button aria-pressed={f.direction === 'credit'} onClick={() => setF({ ...f, direction: 'credit' })}>{t('as.credit')}</button></div>
        <Field label={t('common.amount')}><input className="input" type="number" min={1} value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
        <Field label={t('common.note')}><input className="input" required minLength={2} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
        {err && <div className="error-box">{te(err)}</div>}
      </div>
      <div className="actions"><button className="btn" onClick={onClose}>{t('common.cancel')}</button><button className="btn btn-primary" onClick={submit}>{t('common.save')}</button></div>
    </Modal>
  );
}

function EditModal({ shop, onClose, onSave }: { shop: any; onClose: () => void; onSave: (b: any) => Promise<void> }) {
  const { t } = useI18n();
  const [f, setF] = useState<Record<string, string>>({ shop_name: shop.name, full_name: shop.full_name, phone: formatPhone(shop.phone), address: shop.address ?? '', location_note: shop.location_note ?? '', language: shop.language,
    city: shop.city ?? '', area: shop.area ?? '', whatsapp_phone: shop.whatsapp_phone ? formatPhone(shop.whatsapp_phone) : '', alternate_phone: shop.alternate_phone ? formatPhone(shop.alternate_phone) : '',
    email: shop.email ?? '', cnic: shop.cnic ?? '', ntn: shop.ntn ?? '', shop_type: shop.shop_type ?? '' });
  return (
    <Modal title={t('common.edit')} onClose={onClose}>
      <div className="stack">
        <Field label={t('as.shopName')}><input className="input" value={f.shop_name} onChange={(e) => setF({ ...f, shop_name: e.target.value })} /></Field>
        <Field label={t('as.ownerName')}><input className="input" value={f.full_name} onChange={(e) => setF({ ...f, full_name: e.target.value })} /></Field>
        <Field label={t('auth.phone')}><input className="input ltr" dir="ltr" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
        <Field label={t('as.address')}><input className="input" value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} /></Field>
        <Field label={t('as.locationNote')}><input className="input" value={f.location_note} onChange={(e) => setF({ ...f, location_note: e.target.value })} /></Field>
        <Field label={t('acc.language')}><select className="input" value={f.language} onChange={(e) => setF({ ...f, language: e.target.value })}><option value="ur">اردو</option><option value="en">English</option></select></Field>
        {([['city', 'cust.city'], ['area', 'cust.area'], ['whatsapp_phone', 'cust.whatsapp'], ['alternate_phone', 'cust.altPhone'], ['email', 'cust.email'], ['cnic', 'cust.cnic'], ['ntn', 'cust.ntn'], ['shop_type', 'cust.shopType']] as const).map(([k, label]) => (
          <Field key={k} label={t(label)}><input className={`input ${['whatsapp_phone', 'alternate_phone', 'email', 'cnic', 'ntn'].includes(k) ? 'ltr' : ''}`} name={k} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></Field>
        ))}
      </div>
      <div className="actions"><button className="btn" onClick={onClose}>{t('common.cancel')}</button>
        <button className="btn btn-primary" data-testid="edit-save" onClick={() => void onSave(Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v === '' && !['shop_name', 'full_name', 'phone'].includes(k) ? null : v])))}>{t('common.save')}</button></div>
    </Modal>
  );
}

function PasswordModal({ shopId, onClose, onDone }: { shopId: string; onClose: () => void; onDone: () => void }) {
  const { t, te } = useI18n();
  const [pw, setPw] = useState(() => String(100000 + Math.floor(Math.random() * 900000)));
  const [must, setMust] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  return (
    <Modal title={t('as.resetPassword')} onClose={onClose}>
      <div className="stack">
        <Field label={t('as.tempPassword')}><input className="input mono" dir="ltr" value={pw} onChange={(e) => setPw(e.target.value)} /></Field>
        <label className="check"><input type="checkbox" checked={must} onChange={(e) => setMust(e.target.checked)} />{t('as.mustChange')}</label>
        {err && <div className="error-box">{te(err, ['auth.err'])}</div>}
      </div>
      <div className="actions"><button className="btn" onClick={onClose}>{t('common.cancel')}</button>
        <button className="btn btn-primary" onClick={async () => { setErr(null); try { await api(`/admin/shops/${shopId}/reset-password`, { body: { password: pw, must_change_password: must } }); onDone(); } catch (e) { setErr(e instanceof ApiFailure ? e.code : 'network'); } }}>{t('common.save')}</button></div>
    </Modal>
  );
}

function AdminNotes({ shopId, initial, onSaved }: { shopId: string; initial: any; onSaved: () => void }) {
  const { t, te } = useI18n();
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const [limit, setLimit] = useState(initial?.credit_limit == null ? '' : String(initial.credit_limit));
  const [err, setErr] = useState<string | null>(null);
  const save = async () => {
    setErr(null);
    try { await api(`/admin/shops/${shopId}/admin-details`, { method: 'PUT', body: { notes: notes || null, credit_limit: limit === '' ? null : Number(limit) } }); onSaved(); }
    catch (e) { setErr(e instanceof ApiFailure ? e.code : 'network'); }
  };
  return (
    <section className="card stack" style={{ marginTop: 12 }} data-testid="admin-notes">
      <h2>{t('cust.adminNotes')}</h2>
      <textarea className="input" maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} aria-label={t('cust.adminNotes')} />
      <Field label={t('cust.creditLimit')}><input className="input" type="number" min={0} value={limit} onChange={(e) => setLimit(e.target.value)} name="credit_limit" /></Field>
      {err && <div className="error-box">{te(err)}</div>}
      <button className="btn btn-primary" onClick={save} data-testid="admin-notes-save">{t('common.save')}</button>
    </section>
  );
}
