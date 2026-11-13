import { describe, expect, it } from 'vitest';
import { buildWhatsAppMessage, buildWhatsAppUrl, whatsAppDigits } from '../../shared/whatsapp';

const order = {
  ref: 'KG-261113-0042', shopName: 'Madina Store', customerName: 'Aamir Khan',
  items: [{ name: 'Butter Biscuits', qty: 3, unit: 'Carton' }, { name: 'Mango Candy & Mint', qty: 2, unit: 'Box' }],
  note: 'Deliver before noon',
};

describe('WhatsApp click-to-chat', () => {
  it('message contains shop, customer, reference, items, quantities and totals', () => {
    const m = buildWhatsAppMessage(order, 'KHAN G', 'en');
    expect(m).toContain('Order ref: KG-261113-0042');
    expect(m).toContain('Shop: Madina Store');
    expect(m).toContain('Customer: Aamir Khan');
    expect(m).toContain('1. Butter Biscuits — 3 Carton');
    expect(m).toContain('2. Mango Candy & Mint — 2 Box');
    expect(m).toContain('Total: 2 items, 5 units');
    expect(m).toContain('Note: Deliver before noon');
  });
  it('Urdu message uses Urdu labels', () => {
    const m = buildWhatsAppMessage(order, 'خان جی', 'ur');
    expect(m).toContain('آرڈر نمبر: KG-261113-0042');
    expect(m).toContain('کل: 2 اشیاء، 5 یونٹ'.replace('،', ','));
  });
  it('url is wa.me with digits-only number and encoded text', () => {
    const url = buildWhatsAppUrl('+923001234567', 'A & B\nline 2')!;
    expect(url).toBe('https://wa.me/923001234567?text=A%20%26%20B%0Aline%202');
    expect(decodeURIComponent(url.split('text=')[1])).toBe('A & B\nline 2');
  });
  it('no url when business number missing/invalid (order still saved in app)', () => {
    expect(buildWhatsAppUrl(null, 'x')).toBeNull();
    expect(buildWhatsAppUrl('', 'x')).toBeNull();
    expect(whatsAppDigits('+12')).toBeNull();
  });
});
