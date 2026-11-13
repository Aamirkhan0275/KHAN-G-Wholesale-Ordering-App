import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useI18n } from '../../i18n';
import { useCart } from '../../lib/cart';
import { useCatalogue } from '../../lib/catalogue';
import { api, ApiFailure, imageUrl } from '../../lib/api';
import { cartTotals } from '../../../shared/cart';
import { Icon } from '../../components/Icon';
import { Empty, ErrorBox, Spinner, Stepper, useConfirm, useToast } from '../../components/ui';

export default function Cart() {
  const { t, pick, money, num } = useI18n();
  const cart = useCart();
  const { data, reload } = useCatalogue();
  const confirm = useConfirm();
  const toast = useToast();
  const nav = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiFailure | null>(null);

  const byId = useMemo(() => new Map((data?.products ?? []).map((p) => [p.id, p])), [data]);
  const unavailable = cart.lines.filter((l) => { const p = byId.get(l.productId); return data && (!p || p.availability === 'out'); });
  const totals = cartTotals(cart.lines, (id) => byId.get(id)?.price ?? null);
  const showPrices = !!data?.settings.show_prices;

  const removeLine = async (id: string, name: string) => {
    if (await confirm({ message: t('cart.removeConfirm', { name }), confirmLabel: t('common.remove'), danger: true })) cart.remove(id);
  };

  const submit = async () => {
    if (!cart.lines.length || unavailable.length) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ order: any }>('/shop/orders', {
        body: { items: cart.lines.map((l) => ({ product_id: l.productId, qty: l.qty })), note: cart.note.trim() || null },
      });
      try { sessionStorage.setItem(`kg.order.${r.order.id}`, JSON.stringify(r.order)); } catch { /* ignore */ }
      cart.clear();
      void reload();
      nav(`/done/${r.order.id}`, { replace: true });
    } catch (e) {
      const err = e instanceof ApiFailure ? e : new ApiFailure(0, 'network');
      setError(err);
      if (err.code === 'product_unavailable') { void reload(); toast(t('cart.err.product_unavailable'), 'bad'); }
    } finally { setBusy(false); }
  };

  if (!data && cart.lines.length) return <main className="page narrow"><Spinner /></main>;
  if (!cart.lines.length) {
    return (
      <main className="page narrow">
        <h1>{t('cart.title')}</h1>
        <Empty icon="cart" action={<Link to="/" className="btn btn-primary btn-lg">{t('cart.browse')}</Link>}>{t('cart.empty')}</Empty>
      </main>
    );
  }
  return (
    <main className="page narrow">
      <div className="page-title row between">
        <h1>{t('cart.title')}</h1>
        <button className="btn btn-sm btn-ghost" onClick={async () => { if (await confirm({ message: t('cart.clearConfirm'), danger: true })) cart.clear(); }}>{t('cart.clear')}</button>
      </div>
      {unavailable.length > 0 && <div className="error-box" role="alert" style={{ marginBottom: 10 }}><Icon name="alert" />{t('cart.unavailableAny')}</div>}
      <div className="list" data-testid="cart-lines">
        {cart.lines.map((l) => {
          const p = byId.get(l.productId);
          const name = p ? pick(p.name_en, p.name_ur) : '—';
          const unit = p ? pick(p.unit_label_en, p.unit_label_ur) : '';
          const isOut = !p || p.availability === 'out';
          const img = imageUrl(p?.image_id);
          return (
            <div className={`cart-line ${isOut ? 'unavailable' : ''}`} key={l.productId} data-testid="cart-line">
              {img ? <img className="thumb" src={img} alt="" /> : <div className="thumb" />}
              <div>
                <div style={{ fontWeight: 800 }}>{name}</div>
                <div className="muted small">{unit}{p?.price != null && showPrices ? ` · ${money(p.price)} ${t('cat.perUnit', { unit })}` : ''}</div>
                {isOut && <div className="small" style={{ color: 'var(--bad)', fontWeight: 700 }}>{t('cart.unavailable')}</div>}
                {p?.price != null && showPrices && !isOut && <div style={{ fontWeight: 800 }} className="num">{money(p.price * l.qty)}</div>}
              </div>
              <div className="controls">
                {!isOut && <Stepper value={l.qty} min={1} onChange={(v) => cart.setQty(l.productId, v)} label={name} />}
                <button className="btn btn-danger" onClick={() => removeLine(l.productId, name)} aria-label={`${t('common.remove')} – ${name}`}><Icon name="trash" size={20} />{t('common.remove')}</button>
              </div>
            </div>
          );
        })}
      </div>
      <div className="card" style={{ marginTop: 12 }}>
        <div className="totals">
          <span>{t('cart.totalLines')}</span><span className="num">{num(totals.lines)}</span>
          <span>{t('cart.totalUnits')}</span><span className="num" data-testid="total-units">{num(totals.units)}</span>
          {showPrices && totals.total !== null && <><span className="strong">{t('cart.estimated')}</span><span className="strong num" data-testid="total-price">{money(totals.total)}</span></>}
        </div>
        {showPrices && <p className="muted small" style={{ marginTop: 8, marginBottom: 0 }}>{t('cart.priceNote')}</p>}
      </div>
      <label className="field" style={{ marginTop: 12 }}>
        <span>{t('cart.note')} <span className="muted small">({t('common.optional')})</span></span>
        <textarea className="input" maxLength={300} placeholder={t('cart.notePlaceholder')} value={cart.note} onChange={(e) => cart.setNote(e.target.value)} />
      </label>
      <div style={{ marginTop: 12 }}><ErrorBox error={error} prefixes={['cart.err']} /></div>
      <button className="btn btn-primary btn-lg btn-block" style={{ marginTop: 12 }} disabled={busy || unavailable.length > 0 || !cart.lines.length} onClick={submit} data-testid="place-order">
        <Icon name="check" />{busy ? t('cart.submitting') : t('cart.submit')}
      </button>
    </main>
  );
}
