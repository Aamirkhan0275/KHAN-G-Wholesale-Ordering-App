import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { setLineQty, type CartLine } from '../../shared/cart';
import { useSession } from './session';

interface CartCtx {
  lines: CartLine[];
  note: string;
  qtyOf: (productId: string) => number;
  setQty: (productId: string, qty: number) => void;
  remove: (productId: string) => void;
  clear: () => void;
  setNote: (n: string) => void;
  replace: (lines: CartLine[]) => void;
  units: number;
}

const Ctx = createContext<CartCtx | null>(null);

function load(key: string): { lines: CartLine[]; note: string } {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? 'null');
    if (v && Array.isArray(v.lines)) {
      return { lines: v.lines.filter((l: any) => typeof l?.productId === 'string' && Number.isInteger(l?.qty) && l.qty > 0 && l.qty <= 999), note: typeof v.note === 'string' ? v.note : '' };
    }
  } catch { /* ignore */ }
  return { lines: [], note: '' };
}

/** Cart lives in this device's storage, per signed-in user, until the order is placed. */
export function CartProvider({ children }: { children: ReactNode }) {
  const { me } = useSession();
  const key = me ? `kg.cart.${me.id}` : null;
  const [state, setState] = useState<{ key: string | null; lines: CartLine[]; note: string }>({ key: null, lines: [], note: '' });

  useEffect(() => { setState({ key, ...(key ? load(key) : { lines: [], note: '' }) }); }, [key]);
  useEffect(() => {
    // Only persist once the state belongs to this user's key (avoids overwriting a saved cart on load).
    if (!key || state.key !== key) return;
    try { localStorage.setItem(key, JSON.stringify({ lines: state.lines, note: state.note })); } catch { /* ignore */ }
  }, [key, state]);

  const setQty = useCallback((id: string, qty: number) => setState((s) => ({ ...s, lines: setLineQty(s.lines, id, qty) })), []);
  const value = useMemo<CartCtx>(() => ({
    lines: state.lines,
    note: state.note,
    qtyOf: (id) => state.lines.find((l) => l.productId === id)?.qty ?? 0,
    setQty,
    remove: (id) => setQty(id, 0),
    clear: () => setState((s) => ({ ...s, lines: [], note: '' })),
    setNote: (note) => setState((s) => ({ ...s, note: note.slice(0, 300) })),
    replace: (lines) => setState((s) => ({ ...s, lines })),
    units: state.lines.reduce((a, l) => a + l.qty, 0),
  }), [state, setQty]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCart() {
  const v = useContext(Ctx);
  if (!v) throw new Error('CartProvider missing');
  return v;
}
