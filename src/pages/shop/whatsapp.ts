import { buildWhatsAppMessage, buildWhatsAppUrl } from '../../../shared/whatsapp';
import { api } from '../../lib/api';

export function orderWhatsAppUrl(order: any, businessName: string, businessWhatsapp: string | null, lang: 'en' | 'ur') {
  const items = (order.items ?? [])
    .filter((i: any) => i.line_status !== 'added' && i.requested_qty > 0)
    .map((i: any) => ({
      name: lang === 'ur' && i.name_ur_snapshot ? i.name_ur_snapshot : i.name_en_snapshot,
      qty: i.requested_qty,
      unit: lang === 'ur' ? i.unit_label_ur_snapshot : i.unit_label_en_snapshot,
    }));
  const msg = buildWhatsAppMessage({
    ref: order.ref, shopName: order.shop_name_snapshot, customerName: order.customer_name_snapshot, items, note: order.customer_note,
  }, businessName, lang);
  return { url: buildWhatsAppUrl(businessWhatsapp, msg), message: msg };
}

export function openWhatsApp(orderId: string, url: string) {
  // Recorded only as "opened"; the app cannot know whether Send was pressed in WhatsApp.
  void api(`/shop/orders/${orderId}/whatsapp`, { method: 'POST' }).catch(() => {});
  window.location.href = url;
}
