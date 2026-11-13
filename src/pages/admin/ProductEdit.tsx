import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useI18n } from '../../i18n';
import { useApi } from '../../lib/useApi';
import { api, ApiFailure, imageUrl } from '../../lib/api';
import { resizeImage } from '../../lib/image';
import { Icon } from '../../components/Icon';
import { ErrorBox, Field, Modal, Spinner, Switch, useConfirm, useToast } from '../../components/ui';
import { StockBadge } from './Products';
import type { MessageKey } from '../../i18n/en';

const UNIT_DEFAULTS: Record<string, [string, string]> = {
  carton: ['Carton', 'کارٹن'], box: ['Box', 'ڈبہ'], pack: ['Pack', 'پیک'], dozen: ['Dozen', 'درجن'], piece: ['Piece', 'عدد'],
};

const empty = {
  sku: '', name_en: '', name_ur: '', description_en: '', description_ur: '', category_id: '', unit_type: 'carton',
  unit_label_en: 'Carton', unit_label_ur: 'کارٹن', pieces_per_unit: '', price: '', show_price: true, low_stock_threshold: '5',
  is_active: true, sort_order: '0', initial_stock: '0',
};

export default function ProductEdit() {
  const { id } = useParams();
  const isNew = !id;
  const { t, te, pick } = useI18n();
  const nav = useNavigate();
  const toast = useToast();
  const confirm = useConfirm();
  const cats = useApi<{ categories: any[] }>('/admin/categories');
  const { data, error, loading, reload } = useApi<any>(isNew ? null : `/admin/products/${id}`);
  const [f, setF] = useState<any>(empty);
  const [err, setErr] = useState<ApiFailure | null>(null);
  const [busy, setBusy] = useState(false);
  const [stockOpen, setStockOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!data?.product) return;
    const p = data.product;
    setF({
      ...empty, ...Object.fromEntries(Object.entries(p).map(([k, v]) => [k, v === null ? '' : v])),
      pieces_per_unit: p.pieces_per_unit ?? '', price: p.price ?? '', low_stock_threshold: String(p.low_stock_threshold), sort_order: String(p.sort_order),
    });
  }, [data]);

  if (!isNew && loading && !data) return <main className="page narrow"><Spinner /></main>;
  if (error) return <main className="page narrow"><ErrorBox error={error} onRetry={reload} /></main>;
  const p = data?.product;
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e?.target ? (e.target.type === 'checkbox' ? e.target.checked : e.target.value) : e });

  const payload = () => {
    const body: any = {
      sku: f.sku.trim(), name_en: f.name_en.trim(), name_ur: f.name_ur || null, description_en: f.description_en || null, description_ur: f.description_ur || null,
      category_id: f.category_id || null, unit_type: f.unit_type, unit_label_en: f.unit_label_en, unit_label_ur: f.unit_label_ur,
      pieces_per_unit: f.pieces_per_unit === '' ? null : Number(f.pieces_per_unit), price: f.price === '' ? null : Number(f.price),
      show_price: !!f.show_price, low_stock_threshold: Number(f.low_stock_threshold || 0), is_active: !!f.is_active, sort_order: Number(f.sort_order || 0),
    };
    if (isNew) body.initial_stock = Number(f.initial_stock || 0);
    return body;
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      if (isNew) {
        const r = await api<{ product: any }>('/admin/products', { body: payload() });
        toast(t('common.saved'));
        nav(`/admin/products/${r.product.id}`, { replace: true });
      } else {
        await api(`/admin/products/${id}`, { method: 'PATCH', body: payload() });
        toast(t('common.saved'));
        await reload();
      }
    } catch (e2) { setErr(e2 instanceof ApiFailure ? e2 : new ApiFailure(0, 'network')); }
    finally { setBusy(false); }
  };

  const upload = async (file: File | undefined) => {
    if (!file || !id) return;
    setBusy(true); setErr(null);
    try {
      const dataUrl = await resizeImage(file);
      await api(`/admin/products/${id}/image`, { body: { data: dataUrl } });
      toast(t('common.saved'));
      await reload();
    } catch (e2) { setErr(e2 instanceof ApiFailure ? e2 : new ApiFailure(400, (e2 as Error).message || 'image_type_not_allowed')); }
    finally { setBusy(false); if (fileRef.current) fileRef.current.value = ''; }
  };

  const simple = async (path: string, method: string, msg?: string) => {
    if (msg && !(await confirm({ message: msg, danger: true }))) return false;
    setBusy(true); setErr(null);
    try { await api(path, { method }); toast(t('common.saved')); return true; }
    catch (e2) { setErr(e2 instanceof ApiFailure ? e2 : new ApiFailure(0, 'network')); return false; }
    finally { setBusy(false); }
  };

  return (
    <main className="page narrow">
      <div className="page-title"><Link to="/admin/products" className="btn btn-ghost" aria-label={t('common.back')}><Icon name="back" className="flip-rtl" /></Link><h1>{isNew ? t('ap.add') : t('ap.edit')}</h1></div>
      {!isNew && p && (
        <div className="card row wrap" style={{ marginBottom: 12, alignItems: 'flex-start' }}>
          {p.image_id ? <img src={imageUrl(p.image_id)!} alt="" style={{ width: 140, height: 126, objectFit: 'cover', borderRadius: 12 }} data-testid="product-photo" />
            : <div className="thumb" style={{ width: 140, height: 126, display: 'grid', placeItems: 'center' }}><Icon name="image" size={40} /></div>}
          <div className="stack-sm grow">
            <b>{t('ap.photo')}</b>
            <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" capture="environment" className="sr-only" id="photo" onChange={(e) => void upload(e.target.files?.[0])} data-testid="photo-input" />
            <label htmlFor="photo" className="btn btn-soft"><Icon name="image" />{p.image_id ? t('ap.replacePhoto') : t('ap.uploadPhoto')}</label>
            {p.image_id && <button className="btn btn-ghost btn-sm" onClick={async () => { if (await simple(`/admin/products/${id}/image`, 'DELETE')) await reload(); }}>{t('ap.removePhoto')}</button>}
            <div className="row"><span>{t('ap.stock')}:</span><StockBadge p={p} /><button className="btn btn-sm" onClick={() => setStockOpen(true)} data-testid="adjust-stock">{t('ap.adjustStock')}</button></div>
          </div>
        </div>
      )}
      <form className="card stack" onSubmit={save}>
        <div className="form-grid">
          <Field label={t('ap.sku')}><input className="input mono" required value={f.sku} onChange={set('sku')} pattern="[A-Za-z0-9._\-]{1,32}" dir="ltr" name="sku" /></Field>
          <Field label={t('ap.category')}>
            <select className="input" value={f.category_id} onChange={set('category_id')} name="category_id">
              <option value="">{t('common.none')}</option>
              {cats.data?.categories.map((c) => <option key={c.id} value={c.id}>{pick(c.name_en, c.name_ur)}</option>)}
            </select>
          </Field>
        </div>
        <Field label={t('ap.nameEn')}><input className="input" required minLength={2} maxLength={120} value={f.name_en} onChange={set('name_en')} dir="ltr" name="name_en" /></Field>
        <Field label={t('ap.nameUr')}><input className="input" maxLength={120} value={f.name_ur} onChange={set('name_ur')} dir="rtl" lang="ur" name="name_ur" /></Field>
        <div className="form-grid">
          <Field label={t('ap.descEn')}><textarea className="input" maxLength={500} value={f.description_en} onChange={set('description_en')} dir="ltr" /></Field>
          <Field label={t('ap.descUr')}><textarea className="input" maxLength={500} value={f.description_ur} onChange={set('description_ur')} dir="rtl" lang="ur" /></Field>
        </div>
        <div className="form-grid">
          <Field label={t('ap.unitType')}>
            <select className="input" value={f.unit_type} onChange={(e) => { const [en, ur] = UNIT_DEFAULTS[e.target.value]; setF({ ...f, unit_type: e.target.value, unit_label_en: en, unit_label_ur: ur }); }}>
              {Object.keys(UNIT_DEFAULTS).map((u) => <option key={u} value={u}>{UNIT_DEFAULTS[u][0]} / {UNIT_DEFAULTS[u][1]}</option>)}
            </select>
          </Field>
          <Field label={t('ap.unitEn')}><input className="input" value={f.unit_label_en} onChange={set('unit_label_en')} maxLength={30} /></Field>
          <Field label={t('ap.unitUr')}><input className="input" value={f.unit_label_ur} onChange={set('unit_label_ur')} maxLength={30} dir="rtl" /></Field>
          <Field label={t('ap.pieces')}><input className="input" type="number" min={1} value={f.pieces_per_unit} onChange={set('pieces_per_unit')} /></Field>
        </div>
        <div className="form-grid">
          <Field label={t('ap.price')}><input className="input" type="number" min={0} step="0.01" value={f.price} onChange={set('price')} name="price" /></Field>
          <Field label={t('ap.lowThreshold')}><input className="input" type="number" min={0} value={f.low_stock_threshold} onChange={set('low_stock_threshold')} /></Field>
          {isNew && <Field label={t('ap.initialStock')}><input className="input" type="number" min={0} value={f.initial_stock} onChange={set('initial_stock')} name="initial_stock" /></Field>}
          <Field label={t('ap.sortOrder')}><input className="input" type="number" value={f.sort_order} onChange={set('sort_order')} /></Field>
        </div>
        <div className="row between"><span style={{ fontWeight: 700 }}>{t('ap.showPrice')}</span><Switch checked={!!f.show_price} onChange={set('show_price')} label={t('ap.showPrice')} /></div>
        <div className="row between"><span style={{ fontWeight: 700 }}>{t('ap.active')}</span><Switch checked={!!f.is_active} onChange={set('is_active')} label={t('ap.active')} /></div>
        {err && <div className="error-box" role="alert"><Icon name="alert" />{err.code === 'duplicate' ? t('ap.err.duplicate') : te(err.code, ['ap.err'])}{err.details?.field ? ` (${err.details.field})` : ''}</div>}
        <button className="btn btn-primary btn-lg" disabled={busy} data-testid="save-product">{t('common.save')}</button>
      </form>

      {!isNew && p && (
        <>
          <div className="row wrap" style={{ marginTop: 12 }}>
            {p.archived_at
              ? <button className="btn" onClick={async () => { if (await simple(`/admin/products/${id}/restore`, 'POST')) await reload(); }}>{t('ap.restore')}</button>
              : <button className="btn btn-danger" onClick={async () => { if (await simple(`/admin/products/${id}/archive`, 'POST', t('ap.archiveConfirm'))) await reload(); }} data-testid="archive">{t('ap.archive')}</button>}
            {data.order_lines === 0 && <button className="btn btn-ghost" onClick={async () => { if (await simple(`/admin/products/${id}`, 'DELETE', t('ap.deleteConfirm'))) nav('/admin/products'); }}>{t('common.delete')}</button>}
          </div>
          <h2 style={{ marginTop: 18 }}>{t('ap.movements')}</h2>
          <MovementTable rows={data.movements} />
        </>
      )}
      {stockOpen && p && <StockModal product={p} onClose={() => setStockOpen(false)} onDone={() => { setStockOpen(false); void reload(); }} />}
    </main>
  );
}

export function MovementTable({ rows, showProduct }: { rows: any[]; showProduct?: boolean }) {
  const { t, date, num } = useI18n();
  if (!rows.length) return <p className="muted">—</p>;
  return (
    <div className="table-wrap">
      <table className="table">
        <thead><tr><th>{t('common.date')}</th>{showProduct && <th>{t('common.items')}</th>}<th className="num">{t('ap.change')}</th><th className="num">{t('ap.stock')}</th><th>{t('ap.reason')}</th><th>{t('common.note')}</th></tr></thead>
        <tbody>{rows.map((m) => (
          <tr key={m.id}><td>{date(m.created_at, true)}</td>{showProduct && <td><span className="mono">{m.sku}</span> {m.name_en}</td>}
            <td className="num" style={{ color: m.change < 0 ? 'var(--bad)' : 'var(--ok)', fontWeight: 800 }}>{m.change > 0 ? '+' : ''}{num(m.change)}</td>
            <td className="num">{num(m.stock_after)}</td><td>{t(`reason.${m.reason}` as MessageKey)}</td><td className="small">{m.order_ref ?? m.note ?? ''}{m.actor ? <div className="muted">{m.actor}</div> : null}</td></tr>
        ))}</tbody>
      </table>
    </div>
  );
}

export function StockModal({ product, onClose, onDone }: { product: any; onClose: () => void; onDone: () => void }) {
  const { t, te, pick } = useI18n();
  const [mode, setMode] = useState<'change' | 'set'>('change');
  const [value, setValue] = useState('');
  const [reason, setReason] = useState('restock');
  const [note, setNote] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const submit = async () => {
    setErr(null);
    const n = Number(value);
    if (!Number.isInteger(n) || (mode === 'change' && n === 0) || (mode === 'set' && n < 0)) { setErr('invalid_input'); return; }
    try {
      await api(`/admin/products/${product.id}/stock`, { body: mode === 'change' ? { change: n, reason, note: note || null } : { set_to: n, reason: reason === 'restock' ? 'restock' : 'adjustment', note: note || null } });
      onDone();
    } catch (e) { setErr(e instanceof ApiFailure ? e.code : 'network'); }
  };
  return (
    <Modal title={`${t('ap.adjustStock')}: ${pick(product.name_en, product.name_ur)}`} onClose={onClose}>
      <div className="stack">
        <div className="muted">{t('ap.stock')}: <b className="num">{product.stock_qty}</b></div>
        <div className="segmented"><button aria-pressed={mode === 'change'} onClick={() => setMode('change')}>{t('ap.change')}</button><button aria-pressed={mode === 'set'} onClick={() => setMode('set')}>{t('ap.setTo')}</button></div>
        <input className="input" type="number" inputMode="numeric" value={value} onChange={(e) => setValue(e.target.value)} aria-label={mode === 'change' ? t('ap.change') : t('ap.setTo')} data-testid="stock-value" />
        <label className="field"><span>{t('ap.reason')}</span>
          <select className="input" value={reason} onChange={(e) => setReason(e.target.value)}>
            {(mode === 'change' ? ['restock', 'adjustment', 'damage', 'return'] : ['adjustment', 'restock']).map((r) => <option key={r} value={r}>{t(`reason.${r}` as MessageKey)}</option>)}
          </select></label>
        <input className="input" placeholder={t('common.note')} value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} />
        {err && <div className="error-box">{err === 'stock_cannot_go_negative' ? '< 0' : te(err)}</div>}
      </div>
      <div className="actions"><button className="btn" onClick={onClose}>{t('common.cancel')}</button><button className="btn btn-primary" onClick={submit} data-testid="stock-save">{t('common.save')}</button></div>
    </Modal>
  );
}
