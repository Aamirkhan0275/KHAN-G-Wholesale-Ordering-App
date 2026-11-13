import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useI18n } from '../../i18n';
import { useApi } from '../../lib/useApi';
import { api, ApiFailure, imageUrl } from '../../lib/api';
import { STATUS_TRANSITIONS, LOCKED_STATUSES, type OrderStatus } from '../../../shared/status';
import { formatPhone } from '../../../shared/phone';
import { Icon } from '../../components/Icon';
import { ErrorBox, LineBadge, Modal, Spinner, StatusBadge, useToast } from '../../components/ui';
import type { MessageKey } from '../../i18n/en';

interface Draft { approved: string; note: string; price: string }

export default function AdminOrderDetail() {
  const { id } = useParams();
  const { t, te, date, money, num, pick } = useI18n();
  const toast = useToast();
  const { data, error, loading, reload } = useApi<any>(`/admin/orders/${id}`);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<ApiFailure | null>(null);
  const [nextStatus, setNextStatus] = useState<OrderStatus | ''>('');
  const [statusNote, setStatusNote] = useState('');
  const [note, setNote] = useState('');
  const [subFor, setSubFor] = useState<any | null>(null);

  useEffect(() => {
    if (!data) return;
    const d: Record<string, Draft> = {};
    for (const i of data.items) d[i.id] = { approved: i.approved_qty === null ? '' : String(i.approved_qty), note: i.customer_note ?? '', price: i.unit_price_snapshot === null ? '' : String(i.unit_price_snapshot) };
    setDrafts(d);
    setNextStatus('');
  }, [data]);

  const o = data?.order;
  const locked = o && (LOCKED_STATUSES.includes(o.status) || o.status === 'cancelled');
  const allowed = useMemo(() => (o ? STATUS_TRANSITIONS[o.status as OrderStatus] : []), [o]);

  if (loading && !data) return <main className="page"><Spinner /></main>;
  if (error) return <main className="page"><ErrorBox error={error} onRetry={reload} /></main>;

  const act = async (fn: () => Promise<unknown>, ok?: string) => {
    setBusy(true); setActionError(null);
    try { await fn(); if (ok) toast(ok); await reload(); }
    catch (e) { setActionError(e instanceof ApiFailure ? e : new ApiFailure(0, 'network')); }
    finally { setBusy(false); }
  };

  const saveReview = () => act(() => api(`/admin/orders/${id}/review`, {
    body: {
      items: data.items.filter((i: any) => drafts[i.id]?.approved !== '').map((i: any) => ({
        id: i.id, approved_qty: Number(drafts[i.id].approved), customer_note: drafts[i.id].note.trim() || null,
        unit_price: drafts[i.id].price === '' ? null : Number(drafts[i.id].price),
      })),
    },
  }), t('common.saved'));

  const approveAll = () => setDrafts((d) => Object.fromEntries(Object.entries(d).map(([k, v]) => {
    const line = data.items.find((i: any) => i.id === k);
    return [k, { ...v, approved: String(line.line_status === 'added' ? line.approved_qty ?? 0 : line.requested_qty) }];
  })));

  const errorText = (e: ApiFailure) => {
    if (e.code === 'insufficient_stock') return t('ao.err.insufficient_stock', { list: (e.details?.products ?? []).map((p: any) => `${p.sku} (${p.stock}/${p.needed})`).join(', ') });
    if (e.code === 'missing_prices') return `${t('ao.err.missing_prices')} ${(e.details?.skus ?? []).join(', ')}`;
    return te(e.code, ['ao.err']);
  };

  return (
    <main className="page">
      <div className="page-title row wrap">
        <Link to="/admin/orders" className="btn btn-ghost" aria-label={t('common.back')}><Icon name="back" className="flip-rtl" /></Link>
        <h1 className="mono">{o.ref}</h1><StatusBadge status={o.status} admin />
      </div>
      <div className="grid cols-2">
        <div className="card stack-sm">
          <div><b>{o.shop_name_snapshot}</b> · {o.customer_name_snapshot} · <span className="ltr">{formatPhone(o.customer_phone_snapshot)}</span></div>
          <div className="muted small">{date(o.submitted_at, true)} · {t('units.items', { n: o.item_count })} · {t('units.units', { n: o.total_requested_qty })}</div>
          {o.customer_note && <div className="info-box"><Icon name="list" />{o.customer_note}</div>}
          {o.whatsapp_opened_at && <div className="small muted"><Icon name="whatsapp" size={16} /> {t('ao.whatsappOpened', { time: date(o.whatsapp_opened_at, true) })}</div>}
          <Link to={`/admin/shops/${o.shop_id}`} className="btn btn-sm btn-soft" style={{ alignSelf: 'flex-start' }}><Icon name="store" size={18} />{t('acc.shop')}</Link>
        </div>
        <div className="card stack-sm">
          <h3>{t('ao.changeStatus')}</h3>
          {allowed.length === 0 ? <p className="muted">—</p> : (
            <>
              <div className="row wrap">
                {allowed.map((s) => (
                  <button key={s} className={`btn btn-sm ${nextStatus === s ? 'btn-primary' : ''} ${s === 'cancelled' ? 'btn-danger' : ''}`} aria-pressed={nextStatus === s} onClick={() => setNextStatus(s)} data-testid={`to-${s}`}>
                    {t(['submitted', 'checking', 'needs_confirmation'].includes(s) ? `status.admin.${s}` as MessageKey : `status.${s}` as MessageKey)}
                  </button>
                ))}
              </div>
              {nextStatus && (
                <>
                  <input className="input" placeholder={t('ao.statusNote')} value={statusNote} maxLength={300} onChange={(e) => setStatusNote(e.target.value)} />
                  <button className="btn btn-primary" disabled={busy} data-testid="apply-status"
                    onClick={() => act(() => api(`/admin/orders/${id}/status`, { body: { to: nextStatus, note: statusNote.trim() || null } }), t('common.saved')).then(() => setStatusNote(''))}>
                    {t('common.apply')}
                  </button>
                </>
              )}
            </>
          )}
          <p className="muted small" style={{ margin: 0 }}>{t('ao.stockRule')}</p>
          {data.invoice ? (
            <Link to={`/admin/invoices/${data.invoice.id}`} className="btn btn-soft" data-testid="invoice-link"><Icon name="file" />{t('ao.invoiceView', { no: data.invoice.invoice_no })}{data.invoice.status === 'void' ? ` (${t('ai.void')})` : ''}</Link>
          ) : LOCKED_STATUSES.includes(o.status) && (
            <button className="btn btn-primary" disabled={busy} onClick={() => act(() => api(`/admin/orders/${id}/invoice`, { method: 'POST' }))} data-testid="create-invoice"><Icon name="file" />{t('ao.invoiceCreate')}</button>
          )}
        </div>
      </div>

      {actionError && <div style={{ marginTop: 12 }} className="error-box" role="alert"><Icon name="alert" />{errorText(actionError)}</div>}

      <section className="section">
        <div className="row between wrap"><h2>{t('ao.review')}</h2>
          {!locked && <button className="btn btn-sm btn-soft" onClick={approveAll} data-testid="approve-all"><Icon name="check" size={18} />{t('ao.allAvailable')}</button>}
        </div>
        {locked && <div className="info-box" style={{ marginBottom: 10 }}><Icon name="check" />{t('ao.locked')}</div>}
        <div className="table-wrap">
          <table className="table stack-mobile" data-testid="review-table">
            <thead><tr><th>{t('common.items')}</th><th className="num">{t('ao.requested')}</th><th className="num">{t('ao.stockNow')}</th><th>{t('ao.approve')}</th><th>{t('ao.unitPrice')}</th><th>{t('ao.noteForShop')}</th><th>{t('common.status')}</th></tr></thead>
            <tbody>
              {data.items.map((i: any) => {
                const d = drafts[i.id] ?? { approved: '', note: '', price: '' };
                const img = imageUrl(i.image_id);
                const short = i.current_stock !== null && Number(d.approved || 0) > i.current_stock && !o.stock_deducted_at;
                return (
                  <tr key={i.id} data-testid="review-line">
                    <td><div className="row">{img ? <img src={img} className="thumb" style={{ width: 44, height: 44 }} alt="" /> : null}<div><b>{pick(i.name_en_snapshot, i.name_ur_snapshot)}</b><div className="muted small mono">{i.sku_snapshot}</div>
                      {i.substitute_for_item_id && <div className="small" style={{ color: 'var(--info)' }}>↳ {t('line.added')}</div>}</div></div></td>
                    <td className="num"><b>{i.line_status === 'added' ? '—' : num(i.requested_qty)}</b></td>
                    <td className="num" style={short ? { color: 'var(--bad)', fontWeight: 800 } : undefined}>{i.current_stock ?? '—'}</td>
                    <td style={{ minWidth: 96 }}><input className="input" type="number" min={0} max={i.line_status === 'added' ? 999 : i.requested_qty} inputMode="numeric" disabled={locked}
                      value={d.approved} aria-label={`${t('ao.approve')} ${i.sku_snapshot}`} onChange={(e) => setDrafts({ ...drafts, [i.id]: { ...d, approved: e.target.value } })} /></td>
                    <td style={{ minWidth: 100 }}><input className="input" type="number" min={0} step="0.01" disabled={locked} value={d.price} aria-label={`${t('ao.unitPrice')} ${i.sku_snapshot}`}
                      onChange={(e) => setDrafts({ ...drafts, [i.id]: { ...d, price: e.target.value } })} /></td>
                    <td style={{ minWidth: 160 }}><input className="input" disabled={locked} value={d.note} maxLength={200} aria-label={`${t('ao.noteForShop')} ${i.sku_snapshot}`}
                      onChange={(e) => setDrafts({ ...drafts, [i.id]: { ...d, note: e.target.value } })} /></td>
                    <td><LineBadge status={i.line_status} />
                      {!locked && i.line_status !== 'added' && <button className="btn btn-sm btn-ghost" onClick={() => setSubFor(i)}>{t('ao.substitute')}</button>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="row between wrap" style={{ marginTop: 10 }}>
          <div className="muted">{t('units.units', { n: num(o.total_approved_qty ?? 0) })} · {money(o.approved_total ?? o.requested_total, o.currency)}</div>
          {!locked && <button className="btn btn-primary" disabled={busy} onClick={saveReview} data-testid="save-review"><Icon name="check" />{t('ao.saveReview')}</button>}
        </div>
      </section>

      <div className="grid cols-2">
        <section className="card">
          <h3>{t('ao.history')}</h3>
          <ol className="timeline">
            {data.history.map((h: any) => <li key={h.id}><b>{t(['submitted', 'checking', 'needs_confirmation'].includes(h.to_status) ? `status.admin.${h.to_status}` as MessageKey : `status.${h.to_status}` as MessageKey)}</b>
              <div className="muted small">{date(h.changed_at, true)} · {h.changed_by_name}</div>{h.note && <div className="small">{h.note}</div>}</li>)}
          </ol>
        </section>
        <section className="card stack-sm">
          <h3>{t('ao.internalNotes')}</h3>
          {data.notes.map((n: any) => <div key={n.id} className="small"><b>{n.author}</b> · <span className="muted">{date(n.created_at, true)}</span><div>{n.note}</div></div>)}
          <textarea className="input" value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} aria-label={t('ao.internalNotes')} />
          <button className="btn" disabled={busy || !note.trim()} onClick={() => act(() => api(`/admin/orders/${id}/notes`, { body: { note } })).then(() => setNote(''))}>{t('ao.addNote')}</button>
        </section>
      </div>
      {subFor && <SubstituteModal line={subFor} orderId={id!} onClose={() => setSubFor(null)} onDone={() => { setSubFor(null); void reload(); }} />}
    </main>
  );
}

function SubstituteModal({ line, orderId, onClose, onDone }: { line: any; orderId: string; onClose: () => void; onDone: () => void }) {
  const { t, pick, te } = useI18n();
  const [q, setQ] = useState('');
  const [productId, setProductId] = useState('');
  const [qty, setQty] = useState(String(line.requested_qty));
  const [note, setNote] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const products = useApi<{ products: any[] }>(`/admin/products?filter=active&q=${encodeURIComponent(q)}`);
  const submit = async () => {
    setErr(null);
    try {
      await api(`/admin/orders/${orderId}/review`, {
        body: { items: [{ id: line.id, approved_qty: line.approved_qty ?? 0 }], substitutes: [{ for_item_id: line.id, product_id: productId, qty: Number(qty), customer_note: note || null }] },
      });
      onDone();
    } catch (e) { setErr(e instanceof ApiFailure ? e.code : 'network'); }
  };
  return (
    <Modal title={`${t('ao.substitute')}: ${pick(line.name_en_snapshot, line.name_ur_snapshot)}`} onClose={onClose}>
      <div className="stack">
        <input className="input" placeholder={t('cat.search')} value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="input" value={productId} onChange={(e) => setProductId(e.target.value)} size={6} aria-label={t('ao.substituteProduct')}>
          {products.data?.products.filter((p) => p.id !== line.product_id).map((p) => <option key={p.id} value={p.id}>{p.sku} · {pick(p.name_en, p.name_ur)} ({p.stock_qty})</option>)}
        </select>
        <label className="field"><span>{t('common.qty')}</span><input className="input" type="number" min={1} max={999} value={qty} onChange={(e) => setQty(e.target.value)} /></label>
        <label className="field"><span>{t('ao.noteForShop')}</span><input className="input" value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} /></label>
        {err && <div className="error-box">{te(err, ['ao.err'])}</div>}
      </div>
      <div className="actions"><button className="btn" onClick={onClose}>{t('common.cancel')}</button><button className="btn btn-primary" disabled={!productId || !(Number(qty) >= 1)} onClick={submit}>{t('common.save')}</button></div>
    </Modal>
  );
}
