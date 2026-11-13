import { Hono } from 'hono';
import type { AppEnv } from '../context.js';
import { asUser } from '../lib/db.js';
import { notFound } from '../lib/errors.js';
import { uuidParam } from '../lib/validate.js';
import { renderInvoicePdf, type InvoiceForPdf } from '../lib/invoice-pdf.js';
import { log } from '../lib/log.js';

/** Routes both roles use. Row Level Security decides what each user may see. */
export const commonRoutes = new Hono<AppEnv>();

commonRoutes.get('/notifications', async (c) => {
  const { sql } = c.get('deps');
  const user = c.get('user');
  const rows = await asUser(sql, user.id, (tx) => tx`
    select id, kind, data, link, read_at, created_at from notifications
    where user_id = ${user.id} order by created_at desc limit 50`);
  return c.json({ notifications: rows, unread: rows.filter((r: any) => !r.read_at).length });
});

commonRoutes.post('/notifications/:id/read', async (c) => {
  const { sql } = c.get('deps');
  const user = c.get('user');
  const id = uuidParam(c.req.param('id'));
  const rows = await asUser(sql, user.id, (tx) => tx`
    update notifications set read_at = coalesce(read_at, now()) where id = ${id} and user_id = ${user.id} returning id`);
  if (!rows.length) throw notFound();
  return c.json({ ok: true });
});

commonRoutes.post('/notifications/read-all', async (c) => {
  const { sql } = c.get('deps');
  const user = c.get('user');
  await asUser(sql, user.id, (tx) => tx`update notifications set read_at = now() where user_id = ${user.id} and read_at is null`);
  return c.json({ ok: true });
});

async function loadInvoice(sql: any, userId: string, id: string): Promise<InvoiceForPdf | null> {
  return asUser(sql, userId, async (tx) => {
    const [inv] = await tx<any[]>`select * from invoices where id = ${id}`;
    if (!inv) return null;
    const items = await tx<any[]>`select line_no, sku, name_en, name_ur, unit_label, qty, unit_price, line_total
      from invoice_items where invoice_id = ${id} order by line_no`;
    return { ...inv, items };
  });
}

/** Invoice JSON (for the in-app/printable view). 404 for anyone RLS hides it from. */
commonRoutes.get('/invoices/:id', async (c) => {
  const { sql } = c.get('deps');
  const inv = await loadInvoice(sql, c.get('user').id, uuidParam(c.req.param('id')));
  if (!inv) throw notFound();
  return c.json({ invoice: inv });
});

/** Private PDF: generated on request from the stored snapshot; never a public URL. */
commonRoutes.get('/invoices/:id/pdf', async (c) => {
  const { sql } = c.get('deps');
  const user = c.get('user');
  const id = uuidParam(c.req.param('id'));
  const inv = await loadInvoice(sql, user.id, id);
  if (!inv) throw notFound();
  const bytes = await renderInvoicePdf(inv);
  log('info', 'invoice_pdf', { invoice: inv.invoice_no, by: user.id, role: user.role });
  const disposition = c.req.query('inline') === '1' ? 'inline' : 'attachment';
  return new Response(bytes, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `${disposition}; filename="${inv.invoice_no}.pdf"`,
      'Cache-Control': 'private, no-store',
    },
  });
});
