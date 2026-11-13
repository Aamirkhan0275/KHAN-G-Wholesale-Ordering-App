import { api } from '../../lib/api';
import type { CatProduct } from '../../lib/catalogue';
import { setLineQty, type CartLine } from '../../../shared/cart';

/** Put the shop's most recent order back into the cart, skipping items that are no longer available. */
export async function repeatOrderIntoCart(
  products: CatProduct[],
  cart: { lines: CartLine[]; replace: (l: CartLine[]) => void },
  orderId?: string,
): Promise<{ added: number; skipped: number } | null> {
  let id = orderId;
  if (!id) {
    const list = await api<{ orders: { id: string; status: string }[] }>('/shop/orders?days=365');
    id = list.orders.find((o) => o.status !== 'cancelled')?.id;
    if (!id) return null;
  }
  const { order } = await api<{ order: { items: { product_id: string | null; requested_qty: number; line_status: string }[] } }>(`/shop/orders/${id}`);
  const avail = new Map(products.map((p) => [p.id, p.availability]));
  let lines = cart.lines;
  let added = 0, skipped = 0;
  for (const it of order.items) {
    if (it.line_status === 'added' || !it.product_id || it.requested_qty <= 0) continue;
    const a = avail.get(it.product_id);
    if (!a || a === 'out') { skipped++; continue; }
    const cur = lines.find((l) => l.productId === it.product_id)?.qty ?? 0;
    lines = setLineQty(lines, it.product_id, Math.max(cur, it.requested_qty));
    added++;
  }
  cart.replace(lines);
  return { added, skipped };
}
