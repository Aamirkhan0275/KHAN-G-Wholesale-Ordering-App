import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';

export interface InvoiceForPdf {
  id: string;
  invoice_no: string;
  status: 'issued' | 'void';
  issue_date: string;
  currency: string;
  order_ref: string;
  business_snapshot: { name?: string; phone?: string; whatsapp?: string; address?: string; email?: string; footer?: string };
  shop_snapshot: { name?: string; full_name?: string; phone?: string; address?: string; location_note?: string };
  subtotal: number;
  total: number;
  balance_before: number;
  balance_after: number;
  items: { line_no: number; sku: string; name_en: string; unit_label: string; qty: number; unit_price: number; line_total: number }[];
}

/**
 * The PDF uses the built-in Helvetica font, which covers English/Latin text only.
 * Characters it cannot draw (e.g. Urdu) are dropped; the in-app printable
 * invoice view shows Urdu correctly. Documented as a known limitation.
 */
export function pdfSafe(text: unknown, fallback = ''): string {
  const s = String(text ?? '')
    .replace(/[–—]/g, '-')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return s || fallback;
}

export function money(n: number, currency: string) {
  const v = Number(n || 0);
  const sign = v < 0 ? '-' : '';
  return `${sign}${currency} ${Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fit(text: string, font: PDFFont, size: number, width: number) {
  if (font.widthOfTextAtSize(text, size) <= width) return text;
  let t = text;
  while (t.length > 1 && font.widthOfTextAtSize(t + '...', size) > width) t = t.slice(0, -1);
  return t + '...';
}

export async function renderInvoicePdf(inv: InvoiceForPdf): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Invoice ${inv.invoice_no}`);
  doc.setAuthor(pdfSafe(inv.business_snapshot?.name, 'KHAN G'));
  doc.setCreationDate(new Date(`${inv.issue_date}T00:00:00Z`));
  doc.setModificationDate(new Date(`${inv.issue_date}T00:00:00Z`));
  doc.setProducer('KHAN G Wholesale Ordering App');
  doc.setCreator('KHAN G Wholesale Ordering App');
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const W = 595.28, H = 841.89, M = 40;
  const ink = rgb(0.1, 0.1, 0.12), muted = rgb(0.38, 0.4, 0.45), brand = rgb(0.06, 0.42, 0.29), line = rgb(0.85, 0.86, 0.88);
  const cur = pdfSafe(inv.currency, 'PKR');
  const biz = inv.business_snapshot ?? {};
  const shop = inv.shop_snapshot ?? {};

  const cols = [
    { key: '#', x: M, w: 24, align: 'left' as const },
    { key: 'Item', x: M + 24, w: 245, align: 'left' as const },
    { key: 'Qty', x: M + 269, w: 50, align: 'right' as const },
    { key: 'Unit', x: M + 325, w: 60, align: 'left' as const },
    { key: 'Rate', x: M + 385, w: 60, align: 'right' as const },
    { key: 'Amount', x: M + 445, w: W - 2 * M - 445, align: 'right' as const },
  ];

  let page: PDFPage = doc.addPage([W, H]);
  let y = H - M;
  let pageNo = 1;

  const text = (p: PDFPage, s: string, x: number, yy: number, size = 10, f = font, color = ink) =>
    p.drawText(s, { x, y: yy, size, font: f, color });
  const right = (p: PDFPage, s: string, xRight: number, yy: number, size = 10, f = font, color = ink) =>
    p.drawText(s, { x: xRight - f.widthOfTextAtSize(s, size), y: yy, size, font: f, color });

  const header = () => {
    text(page, fit(pdfSafe(biz.name, 'KHAN G'), bold, 20, 300), M, y - 18, 20, bold, brand);
    let by = y - 34;
    for (const l of [biz.address, [biz.phone && `Phone: ${biz.phone}`, biz.whatsapp && `WhatsApp: ${biz.whatsapp}`].filter(Boolean).join('   '), biz.email]) {
      const s = pdfSafe(l);
      if (s) { text(page, fit(s, font, 9, 300), M, by, 9, font, muted); by -= 12; }
    }
    right(page, inv.status === 'void' ? 'INVOICE (VOID)' : 'INVOICE', W - M, y - 18, 18, bold, inv.status === 'void' ? rgb(0.7, 0.1, 0.1) : ink);
    right(page, `No: ${pdfSafe(inv.invoice_no)}`, W - M, y - 34, 10, bold);
    right(page, `Date: ${pdfSafe(inv.issue_date)}`, W - M, y - 47, 10);
    right(page, `Order: ${pdfSafe(inv.order_ref)}`, W - M, y - 60, 10);
    y = Math.min(by, y - 66) - 10;
    page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 1, color: line });
    y -= 18;
  };

  const tableHead = () => {
    page.drawRectangle({ x: M, y: y - 6, width: W - 2 * M, height: 20, color: rgb(0.94, 0.96, 0.95) });
    for (const c of cols) {
      if (c.align === 'right') right(page, c.key, c.x + c.w - 4, y, 9, bold, muted);
      else text(page, c.key, c.x + 4, y, 9, bold, muted);
    }
    y -= 22;
  };

  const footer = () => {
    const f = pdfSafe(biz.footer);
    if (f) text(page, fit(f, font, 8, W - 2 * M - 60), M, 28, 8, font, muted);
    text(page, 'Customer account statement - not a tax invoice.', M, 18, 7, font, muted);
    right(page, `Page ${pageNo}`, W - M, 18, 8, font, muted);
  };

  header();
  text(page, 'BILL TO', M, y, 9, bold, muted);
  y -= 14;
  text(page, fit(pdfSafe(shop.name, 'Shop'), bold, 12, 320), M, y, 12, bold);
  y -= 14;
  for (const l of [shop.full_name, shop.phone, shop.address, shop.location_note]) {
    const s = pdfSafe(l);
    if (s) { text(page, fit(s, font, 9.5, 320), M, y, 9.5, font, muted); y -= 12; }
  }
  y -= 12;
  tableHead();

  for (const it of inv.items) {
    if (y < 150) {
      footer();
      page = doc.addPage([W, H]);
      pageNo++;
      y = H - M;
      header();
      tableHead();
    }
    const name = pdfSafe(it.name_en, it.sku);
    text(page, String(it.line_no), cols[0].x + 4, y, 9.5);
    text(page, fit(name, font, 9.5, cols[1].w - 8), cols[1].x + 4, y, 9.5);
    text(page, fit(pdfSafe(it.sku), font, 7.5, cols[1].w - 8), cols[1].x + 4, y - 10, 7.5, font, muted);
    right(page, String(it.qty), cols[2].x + cols[2].w - 4, y, 9.5);
    text(page, fit(pdfSafe(it.unit_label, 'Carton'), font, 9, cols[3].w - 6), cols[3].x + 4, y, 9);
    right(page, Number(it.unit_price).toLocaleString('en-US', { minimumFractionDigits: 2 }), cols[4].x + cols[4].w - 4, y, 9.5);
    right(page, Number(it.line_total).toLocaleString('en-US', { minimumFractionDigits: 2 }), cols[5].x + cols[5].w - 4, y, 9.5);
    y -= 16;
    page.drawLine({ start: { x: M, y: y + 2 }, end: { x: W - M, y: y + 2 }, thickness: 0.5, color: line });
    y -= 8;
  }

  const totalQty = inv.items.reduce((s, i) => s + i.qty, 0);
  y -= 6;
  const rows: [string, string, boolean][] = [
    [`Items: ${inv.items.length}   Units: ${totalQty}`, '', false],
    ['Invoice total', money(inv.total, cur), true],
    ['Previous balance', money(inv.balance_before, cur), false],
    ['Balance after this invoice', money(inv.balance_after, cur), true],
  ];
  for (const [label, value, strong] of rows) {
    if (y < 60) { footer(); page = doc.addPage([W, H]); pageNo++; y = H - M; }
    if (!value) { text(page, label, M, y, 9, font, muted); y -= 18; continue; }
    right(page, label, W - M - 130, y, strong ? 11 : 10, strong ? bold : font, strong ? ink : muted);
    right(page, value, W - M, y, strong ? 11 : 10, strong ? bold : font);
    y -= 18;
  }
  footer();
  return doc.save();
}
