import { memo, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useI18n } from '../../i18n';
import { useCart } from '../../lib/cart';
import { filterProducts, useCatalogue, type CatProduct } from '../../lib/catalogue';
import { api, imageUrl } from '../../lib/api';
import { Icon } from '../../components/Icon';
import { AvailabilityBadge, Empty, ErrorBox, Spinner, Stepper, useToast } from '../../components/ui';
import { ReminderBanner } from './ReminderBanner';
import { repeatOrderIntoCart } from './repeat';

const ProductCard = memo(function ProductCard({ p, qty, fav, onQty, onFav }: {
  p: CatProduct; qty: number; fav: boolean; onQty: (id: string, q: number) => void; onFav: (id: string, on: boolean) => void;
}) {
  const { t, pick, money } = useI18n();
  const name = pick(p.name_en, p.name_ur);
  const unit = pick(p.unit_label_en, p.unit_label_ur);
  const out = p.availability === 'out';
  const img = imageUrl(p.image_id);
  return (
    <article className={`product-card ${qty > 0 ? 'in-cart' : ''} ${out ? 'out' : ''}`} data-testid="product-card" data-sku={p.sku}>
      <div className="photo">{img ? <img src={img} alt={name} loading="lazy" decoding="async" /> : <Icon name="image" className="ph" />}</div>
      {qty > 0 && <span className="qty-badge" aria-hidden="true">{qty}</span>}
      <button className="fav" aria-pressed={fav} aria-label={fav ? t('cat.removeFav') : t('cat.addFav')} onClick={() => onFav(p.id, !fav)}>
        <Icon name="heart" size={22} />
      </button>
      <div className="body">
        <div className="name">{name}</div>
        <div className="meta">{unit}{p.pieces_per_unit ? ` · ${t('cat.piecesPer', { n: p.pieces_per_unit, unit })}` : ''}</div>
        <div className="row between wrap" style={{ gap: 4 }}>
          <AvailabilityBadge availability={p.availability} />
          {p.price !== null && <span className="price num">{money(p.price)}</span>}
        </div>
        <div className="actions">
          {out ? <button className="btn btn-block add-btn" disabled>{t('cat.outOfStock')}</button>
            : qty === 0 ? <button className="btn btn-soft add-btn" onClick={() => onQty(p.id, 1)} data-testid="add-btn"><Icon name="plus" />{t('cat.add')}</button>
            : <Stepper value={qty} min={0} onChange={(v) => onQty(p.id, v)} label={name} />}
        </div>
      </div>
    </article>
  );
});

export default function Catalogue() {
  const { t, pick, num } = useI18n();
  const { data, error, loading, reload, setFavourite } = useCatalogue();
  const cart = useCart();
  const toast = useToast();
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState('');
  const [cat, setCat] = useState<string>('all');
  const [busyRepeat, setBusyRepeat] = useState(false);

  const products = useMemo(() => (data ? filterProducts(data.products, q, cat as any, data.favourites, data.categories) : []), [data, q, cat]);
  const favs = useMemo(() => new Set(data?.favourites ?? []), [data]);

  const repeat = async () => {
    if (!data) return;
    setBusyRepeat(true);
    try {
      const r = await repeatOrderIntoCart(data.products, cart);
      if (r === null) toast(t('orders.empty', { n: 365 }), 'bad');
      else {
        toast(t('cart.repeatAdded', { n: r.added }));
        if (r.skipped) toast(t('cart.repeatSkipped', { n: r.skipped }), 'bad');
        if (r.added) nav('/cart');
      }
    } catch { toast(t('common.error'), 'bad'); }
    finally { setBusyRepeat(false); }
  };

  useEffect(() => {
    if (params.get('reorder') === '1') { params.delete('reorder'); setParams(params, { replace: true }); }
  }, [params, setParams]);

  const onFav = async (id: string, on: boolean) => { try { await setFavourite(id, on); } catch { toast(t('common.error'), 'bad'); } };

  return (
    <main className="page">
      <ReminderBanner onRepeat={repeat} />
      <div className="search-bar">
        <div className="search">
          <Icon name="search" />
          <input className="input" type="search" placeholder={t('cat.search')} aria-label={t('common.search')} value={q} onChange={(e) => setQ(e.target.value)} data-testid="search" />
          {q && <button className="icon-btn clear" aria-label={t('cat.clearSearch')} onClick={() => setQ('')} style={{ color: 'var(--muted)' }}><Icon name="x" /></button>}
        </div>
        <div className="chips" role="toolbar" aria-label={t('nav.categories')}>
          <button className="chip" aria-pressed={cat === 'all'} onClick={() => setCat('all')}>{t('cat.allCategories')}</button>
          <button className="chip" aria-pressed={cat === 'fav'} onClick={() => setCat('fav')}><Icon name="heart" size={18} />{t('cat.favourites')}</button>
          {data?.categories.map((c) => <button key={c.id} className="chip" aria-pressed={cat === c.id} onClick={() => setCat(c.id)}>{pick(c.name_en, c.name_ur)}</button>)}
        </div>
      </div>
      <div className="row between" style={{ margin: '6px 0 10px' }}>
        <span className="muted small">{data ? t('ap.count', { n: num(products.length) }) : ''}</span>
        <button className="btn btn-sm btn-soft" onClick={repeat} disabled={busyRepeat || !data} data-testid="repeat-last"><Icon name="repeat" size={18} />{t('cat.repeatLast')}</button>
      </div>
      {error && !data && <ErrorBox error={error} onRetry={reload} />}
      {!data && loading && <Spinner />}
      {data && products.length === 0 && (
        <Empty icon="search" action={q ? <button className="btn" onClick={() => setQ('')}>{t('cat.clearSearch')}</button> : undefined}>{t('cat.empty')}</Empty>
      )}
      <div className="product-grid">
        {products.map((p) => <ProductCard key={p.id} p={p} qty={cart.qtyOf(p.id)} fav={favs.has(p.id)} onQty={cart.setQty} onFav={onFav} />)}
      </div>
      {cart.lines.length > 0 && (
        <Link to="/cart" className="cart-bar" data-testid="cart-bar">
          <Icon name="cart" />
          <span className="count grow">{t('cat.cartBar', { lines: num(cart.lines.length), units: num(cart.units) })}</span>
          <span className="btn btn-sm">{t('cat.viewCart')}</span>
        </Link>
      )}
    </main>
  );
}
