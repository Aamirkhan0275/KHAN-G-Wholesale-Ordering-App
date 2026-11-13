/**
 * WhatsApp click-to-chat. This only OPENS WhatsApp with a pre-filled message;
 * the shopkeeper still has to press Send inside WhatsApp.
 */
export interface WhatsAppOrder {
  ref: string;
  shopName: string;
  customerName: string;
  items: { name: string; qty: number; unit: string }[];
  note?: string | null;
}

export type WaLang = 'en' | 'ur';

const LABELS = {
  en: { title: 'New order', ref: 'Order ref', shop: 'Shop', customer: 'Customer', items: 'Items', total: 'Total', cartons: 'units', lines: 'items', note: 'Note' },
  ur: { title: 'نیا آرڈر', ref: 'آرڈر نمبر', shop: 'دکان', customer: 'گاہک', items: 'اشیاء', total: 'کل', cartons: 'یونٹ', lines: 'اشیاء', note: 'نوٹ' },
} as const;

export function buildWhatsAppMessage(order: WhatsAppOrder, businessName: string, lang: WaLang = 'en'): string {
  const L = LABELS[lang];
  const totalQty = order.items.reduce((s, i) => s + i.qty, 0);
  const lines = [
    `*${businessName} – ${L.title}*`,
    `${L.ref}: ${order.ref}`,
    `${L.shop}: ${order.shopName}`,
    `${L.customer}: ${order.customerName}`,
    '',
    `${L.items}:`,
    ...order.items.map((i, n) => `${n + 1}. ${i.name} — ${i.qty} ${i.unit}`),
    '',
    `${L.total}: ${order.items.length} ${L.lines}, ${totalQty} ${L.cartons}`,
  ];
  if (order.note && order.note.trim()) lines.push(`${L.note}: ${order.note.trim()}`);
  return lines.join('\n');
}

/** wa.me wants the number as digits only, international format, no + or 0 prefix. */
export function whatsAppDigits(e164: string | null | undefined): string | null {
  if (!e164) return null;
  const d = e164.replace(/\D/g, '');
  return /^[1-9]\d{7,14}$/.test(d) ? d : null;
}

export function buildWhatsAppUrl(businessE164: string | null | undefined, message: string): string | null {
  const digits = whatsAppDigits(businessE164);
  if (!digits) return null;
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
}
