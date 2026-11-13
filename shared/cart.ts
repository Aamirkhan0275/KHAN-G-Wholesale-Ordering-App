export const MAX_LINE_QTY = 999;

export interface CartLine { productId: string; qty: number }

/** Clamp a quantity to a whole number in 0..MAX_LINE_QTY (0 removes the line). */
export function clampQty(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(String(value ?? '').trim());
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(MAX_LINE_QTY, Math.floor(n)));
}

export function setLineQty(lines: CartLine[], productId: string, qty: number): CartLine[] {
  const q = clampQty(qty);
  const rest = lines.filter((l) => l.productId !== productId);
  if (q === 0) return rest;
  const idx = lines.findIndex((l) => l.productId === productId);
  if (idx === -1) return [...lines, { productId, qty: q }];
  const copy = [...lines];
  copy[idx] = { productId, qty: q };
  return copy;
}

export function cartTotals(lines: CartLine[], priceOf: (id: string) => number | null | undefined) {
  let units = 0;
  let total = 0;
  let allPriced = lines.length > 0;
  for (const l of lines) {
    units += l.qty;
    const p = priceOf(l.productId);
    if (p == null) allPriced = false;
    else total += p * l.qty;
  }
  return { lines: lines.length, units, total: allPriced ? Math.round(total * 100) / 100 : null };
}
