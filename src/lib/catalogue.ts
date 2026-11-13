import { useCallback, useEffect, useState } from 'react';
import { api, ApiFailure } from './api';

export interface CatProduct {
  id: string; sku: string; name_en: string; name_ur: string | null; description_en: string | null; description_ur: string | null;
  category_id: string | null; unit_type: string; unit_label_en: string; unit_label_ur: string; pieces_per_unit: number | null;
  image_id: string | null; price: number | null; availability: 'in' | 'low' | 'out'; sort_order: number;
}
export interface CatCategory { id: string; name_en: string; name_ur: string | null }
export interface Catalogue {
  categories: CatCategory[]; products: CatProduct[]; favourites: string[];
  settings: { business_name: string; business_name_ur: string | null; business_whatsapp: string | null; currency: string; show_prices: boolean };
}

const KEY = 'kg.catalogue.v1';
let memory: Catalogue | null = null;
const subs = new Set<(c: Catalogue) => void>();

function cached(): Catalogue | null {
  if (memory) return memory;
  try { const v = JSON.parse(localStorage.getItem(KEY) ?? 'null'); if (v?.products) return (memory = v); } catch { /* ignore */ }
  return null;
}
function store(c: Catalogue) {
  memory = c;
  try { localStorage.setItem(KEY, JSON.stringify(c)); } catch { /* quota */ }
  subs.forEach((f) => f(c));
}
export function clearCatalogueCache() { memory = null; try { localStorage.removeItem(KEY); } catch { /* ignore */ } }

/** Catalogue with a stale copy for instant/offline display; always refreshed from the server. */
export function useCatalogue() {
  const [data, setData] = useState<Catalogue | null>(cached());
  const [error, setError] = useState<ApiFailure | null>(null);
  const [loading, setLoading] = useState(true);
  const [stale, setStale] = useState(!!cached());
  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const c = await api<Catalogue>('/shop/catalogue');
      store(c);
      setStale(false);
      setError(null);
    } catch (e) {
      setError(e instanceof ApiFailure ? e : new ApiFailure(0, 'network'));
    } finally { setLoading(false); }
  }, []);
  useEffect(() => {
    const f = (c: Catalogue) => setData(c);
    subs.add(f);
    void reload();
    return () => { subs.delete(f); };
  }, [reload]);
  const setFavourite = useCallback(async (id: string, on: boolean) => {
    const cur = memory;
    if (cur) store({ ...cur, favourites: on ? [...new Set([...cur.favourites, id])] : cur.favourites.filter((x) => x !== id) });
    try { await api(`/shop/favourites/${id}`, { method: on ? 'POST' : 'DELETE' }); }
    catch { if (cur) store(cur); throw new Error('fav_failed'); }
  }, []);
  return { data, error, loading, stale, reload, setFavourite };
}

export function normalizeSearch(s: string) {
  return s.toLowerCase().normalize('NFKD').replace(/[ً-ٰٟ]/g, '').replace(/[\s\-_.()]+/g, ' ').trim();
}

export function filterProducts(products: CatProduct[], q: string, categoryId: string | 'all' | 'fav', favs: string[], cats: CatCategory[]) {
  const nq = normalizeSearch(q);
  const catName = new Map(cats.map((c) => [c.id, normalizeSearch(`${c.name_en} ${c.name_ur ?? ''}`)]));
  return products.filter((p) => {
    if (categoryId === 'fav' && !favs.includes(p.id)) return false;
    if (categoryId !== 'all' && categoryId !== 'fav' && p.category_id !== categoryId) return false;
    if (!nq) return true;
    const hay = normalizeSearch(`${p.name_en} ${p.name_ur ?? ''} ${p.sku} ${catName.get(p.category_id ?? '') ?? ''}`);
    return nq.split(' ').every((w) => hay.includes(w));
  });
}
