/**
 * Demo data for local development and preview deployments ONLY.
 * Product names are generic (no real brands); photos are generated illustrations
 * so the catalogue looks realistic until the owner uploads real product photos.
 */
import type { Sql } from '../server/lib/db.js';
import { asUser } from '../server/lib/db.js';
import { hashPassword } from '../server/lib/auth.js';
import { changeStatus, generateInvoice, reviewOrder } from '../server/lib/orders.js';
import { log } from '../server/lib/log.js';

export const DEMO_ADMIN = { phone: '+923000000001', password: 'KhanG@admin1', name: 'Owner (demo)' };
export const DEMO_SHOPS = [
  { phone: '+923001110001', password: 'shop1234', name: 'Aamir Khan', shop: 'Madina General Store', status: 'active', lang: 'ur' },
  { phone: '+923001110002', password: 'shop1234', name: 'Bilal Ahmed', shop: 'Bismillah Karyana', status: 'active', lang: 'ur' },
  { phone: '+923001110003', password: 'shop1234', name: 'Sana Malik', shop: 'City Mart Peshawar', status: 'active', lang: 'en' },
  { phone: '+923001110004', password: 'shop1234', name: 'Yousaf Ali', shop: 'Yousaf Traders', status: 'active', lang: 'ur' },
  { phone: '+923001110005', password: 'shop1234', name: 'Imran Shah', shop: 'Shah Kiryana Store', status: 'active', lang: 'ur' },
  { phone: '+923001110006', password: 'shop1234', name: 'Naveed Iqbal', shop: 'New Pending Store', status: 'pending', lang: 'ur' },
  { phone: '+923001110007', password: 'shop1234', name: 'Kashif Raza', shop: 'Closed Shop (inactive)', status: 'inactive', lang: 'en' },
] as const;

const CATEGORIES = [
  { en: 'Biscuits', ur: 'بسکٹ', color: '#c27c2c', icon: 'biscuit' },
  { en: 'Candies', ur: 'کینڈی', color: '#d6336c', icon: 'candy' },
  { en: 'Toffees', ur: 'ٹافیاں', color: '#9c36b5', icon: 'toffee' },
  { en: 'Nimko', ur: 'نمکو', color: '#e8590c', icon: 'nimko' },
  { en: 'Snacks', ur: 'اسنیکس', color: '#2f9e44', icon: 'chips' },
  { en: 'Chocolates', ur: 'چاکلیٹ', color: '#5c3a21', icon: 'choco' },
  { en: 'Wafers', ur: 'ویفرز', color: '#1971c2', icon: 'wafer' },
  { en: 'Bubble Gum', ur: 'ببل گم', color: '#e64980', icon: 'gum' },
  { en: 'Juices & Drinks', ur: 'جوس اور مشروبات', color: '#f08c00', icon: 'drink' },
  { en: 'Cakes & Rusk', ur: 'کیک اور رس', color: '#a07b4f', icon: 'cake' },
];

const ITEMS: Record<string, [string, string][]> = {
  Biscuits: [['Butter Biscuits', 'بٹر بسکٹ'], ['Chocolate Cream Biscuits', 'چاکلیٹ کریم بسکٹ'], ['Coconut Biscuits', 'ناریل بسکٹ'], ['Digestive Biscuits', 'ڈائجسٹو بسکٹ'], ['Salted Crackers', 'نمکین کریکرز'], ['Zeera Biscuits', 'زیرہ بسکٹ'], ['Orange Cream Biscuits', 'اورنج کریم بسکٹ'], ['Milk Biscuits', 'دودھ بسکٹ'], ['Strawberry Cream Biscuits', 'اسٹرابیری کریم بسکٹ'], ['Nankhatai', 'نان خطائی']],
  Candies: [['Mango Candy', 'آم کینڈی'], ['Mint Candy', 'پودینہ کینڈی'], ['Lemon Drops', 'لیموں ڈراپس'], ['Imli Candy', 'املی کینڈی'], ['Fruit Mix Candy', 'فروٹ مکس کینڈی'], ['Cola Candy', 'کولا کینڈی'], ['Lollipops Assorted', 'لالی پاپ مکس'], ['Jelly Beans', 'جیلی بینز']],
  Toffees: [['Milk Toffee', 'دودھ ٹافی'], ['Caramel Toffee', 'کیریمل ٹافی'], ['Chocolate Eclairs', 'چاکلیٹ ایکلیئرز'], ['Coffee Toffee', 'کافی ٹافی'], ['Elaichi Toffee', 'الائچی ٹافی'], ['Chewy Fruit Toffee', 'چیوی فروٹ ٹافی'], ['Coconut Toffee', 'ناریل ٹافی']],
  Nimko: [['Daal Moth', 'دال موٹھ'], ['Chana Daal', 'چنا دال'], ['Mix Nimko', 'مکس نمکو'], ['Masala Peanuts', 'مصالحہ مونگ پھلی'], ['Spicy Sev', 'مصالحہ سیو'], ['Salted Peanuts', 'نمکین مونگ پھلی'], ['Bombay Mix', 'بمبئی مکس'], ['Corn Nimko', 'مکئی نمکو']],
  Snacks: [['Salted Potato Chips', 'نمکین آلو چپس'], ['Masala Chips', 'مصالحہ چپس'], ['Cheese Puffs', 'چیز پفس'], ['Ketchup Chips', 'کیچپ چپس'], ['Corn Rings', 'کارن رنگز'], ['Popcorn Butter', 'بٹر پاپ کارن'], ['Pretzel Sticks', 'پریٹزل اسٹکس']],
  Chocolates: [['Milk Chocolate Bar', 'ملک چاکلیٹ بار'], ['Hazelnut Chocolate', 'ہیزل نٹ چاکلیٹ'], ['Chocolate Wafer Bar', 'چاکلیٹ ویفر بار'], ['Choco Coins', 'چاکو کوائنز'], ['Dark Chocolate', 'ڈارک چاکلیٹ']],
  Wafers: [['Vanilla Wafers', 'ونیلا ویفرز'], ['Chocolate Wafers', 'چاکلیٹ ویفرز'], ['Strawberry Wafers', 'اسٹرابیری ویفرز'], ['Wafer Rolls', 'ویفر رولز'], ['Lemon Wafers', 'لیمن ویفرز']],
  'Bubble Gum': [['Strawberry Bubble Gum', 'اسٹرابیری ببل گم'], ['Tutti Frutti Gum', 'ٹوٹی فروٹی گم'], ['Mint Chewing Gum', 'منٹ چیونگ گم'], ['Gum Tape Roll', 'گم ٹیپ رول']],
  'Juices & Drinks': [['Mango Juice 200ml', 'آم جوس 200 ملی'], ['Apple Juice 200ml', 'سیب جوس 200 ملی'], ['Orange Drink 250ml', 'اورنج ڈرنک 250 ملی'], ['Lemon Drink 250ml', 'لیمن ڈرنک 250 ملی'], ['Guava Nectar 200ml', 'امرود نیکٹر 200 ملی']],
  'Cakes & Rusk': [['Plain Cake Slice', 'سادہ کیک سلائس'], ['Chocolate Cup Cake', 'چاکلیٹ کپ کیک'], ['Rusk Plain', 'سادہ رس'], ['Fruit Cake', 'فروٹ کیک'], ['Swiss Roll', 'سوئس رول']],
};

const SIZES: { en: string; ur: string; per: number; unit: ['carton' | 'box', string, string]; factor: number }[] = [
  { en: '(Small Pack)', ur: '(چھوٹا پیک)', per: 48, unit: ['box', 'Box', 'ڈبہ'], factor: 0.6 },
  { en: '(Family Pack)', ur: '(فیملی پیک)', per: 24, unit: ['carton', 'Carton', 'کارٹن'], factor: 1.4 },
  { en: '(Jumbo Carton)', ur: '(جمبو کارٹن)', per: 12, unit: ['carton', 'Carton', 'کارٹن'], factor: 2.2 },
];

function escapeXml(s: string) { return s.replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]!)); }

function shade(hex: string, amt: number) {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v: number) => Math.max(0, Math.min(255, v + amt));
  return '#' + [ch(n >> 16), ch((n >> 8) & 255), ch(n & 255)].map((v) => v.toString(16).padStart(2, '0')).join('');
}

const ICONS: Record<string, string> = {
  biscuit: '<circle cx="200" cy="150" r="56" fill="#f3d19c" stroke="#b07a2a" stroke-width="6"/><circle cx="180" cy="135" r="6" fill="#b07a2a"/><circle cx="215" cy="140" r="6" fill="#b07a2a"/><circle cx="195" cy="170" r="6" fill="#b07a2a"/><circle cx="222" cy="168" r="5" fill="#b07a2a"/>',
  candy: '<path d="M140 150 l-30 -24 v48z M260 150 l30 -24 v48z" fill="#fff"/><ellipse cx="200" cy="150" rx="62" ry="40" fill="#fff"/><path d="M160 135 q40 30 80 0" stroke="#d6336c" stroke-width="8" fill="none"/>',
  toffee: '<rect x="145" y="118" width="110" height="64" rx="18" fill="#fff"/><path d="M145 150 l-35 -26 v52z M255 150 l35 -26 v52z" fill="#f1e1ff"/>',
  nimko: '<path d="M135 190 q65 -110 130 0z" fill="#ffd8a8"/><circle cx="175" cy="165" r="9" fill="#e8590c"/><circle cx="205" cy="150" r="8" fill="#a5522c"/><circle cx="228" cy="172" r="9" fill="#e8590c"/>',
  chips: '<path d="M150 110 h100 l-12 100 h-76z" fill="#fff"/><ellipse cx="200" cy="150" rx="30" ry="18" fill="#ffe066"/>',
  choco: '<rect x="140" y="105" width="120" height="90" rx="8" fill="#7b4a2a"/><path d="M180 105 v90 M220 105 v90 M140 150 h120" stroke="#5c3a21" stroke-width="5"/>',
  wafer: '<rect x="130" y="125" width="140" height="50" rx="6" fill="#ffe8a3"/><path d="M130 142 h140 M130 158 h140" stroke="#d9a441" stroke-width="5"/>',
  gum: '<circle cx="200" cy="150" r="55" fill="#ffc9de"/><circle cx="182" cy="133" r="14" fill="#fff" opacity=".7"/>',
  drink: '<rect x="165" y="95" width="70" height="115" rx="10" fill="#fff"/><rect x="165" y="135" width="70" height="40" fill="#ffd43b"/><rect x="205" y="78" width="8" height="24" fill="#fff"/>',
  cake: '<path d="M140 190 v-50 h120 v50z" fill="#f3d9b1"/><path d="M140 140 q60 -40 120 0" fill="#fff"/><circle cx="200" cy="112" r="9" fill="#e03131"/>',
};

export function productSvg(nameEn: string, catEn: string, color: string, icon: string, sku: string) {
  const words = nameEn.split(' ');
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    if ((cur + ' ' + w).trim().length > 18) { lines.push(cur.trim()); cur = w; } else cur += ' ' + w;
  }
  if (cur.trim()) lines.push(cur.trim());
  const text = lines.slice(0, 3).map((l, i) => `<text x="200" y="${262 + i * 26}" text-anchor="middle" font-family="Arial, sans-serif" font-size="22" font-weight="700" fill="#fff">${escapeXml(l)}</text>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 360" width="400" height="360">
<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${shade(color, 40)}"/><stop offset="1" stop-color="${shade(color, -30)}"/></linearGradient></defs>
<rect width="400" height="360" fill="${shade(color, 95)}"/>
<path d="M60 70 L200 30 L340 70 L340 330 L60 330 Z" fill="url(#g)"/>
<path d="M60 70 L200 30 L340 70 L200 105 Z" fill="${shade(color, 60)}" opacity=".55"/>
<rect x="60" y="225" width="280" height="105" fill="#000" opacity=".18"/>
${ICONS[icon] ?? ''}
${text}
<text x="330" y="60" text-anchor="end" font-family="Arial, sans-serif" font-size="14" fill="#fff" opacity=".85">${escapeXml(catEn.toUpperCase())}</text>
<text x="70" y="320" font-family="monospace" font-size="12" fill="#fff" opacity=".7">${escapeXml(sku)}</text>
</svg>`;
}

function rnd(seed: number) { // deterministic PRNG
  let s = seed;
  return () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
}

export async function seedDemo(sql: Sql, opts: { onlyIfEmpty?: boolean } = {}) {
  if (opts.onlyIfEmpty) {
    const [{ n }] = await sql<any[]>`select count(*) as n from products`;
    if (n > 0) return { seeded: false };
  }
  const r = rnd(42);
  await sql`update app_settings set business_name = coalesce(nullif(business_name, ''), 'KHAN G'),
    business_name_ur = coalesce(business_name_ur, 'خان جی'),
    business_whatsapp = coalesce(business_whatsapp, '+923001234567'),
    business_phone = coalesce(business_phone, '0300 1234567'),
    business_address = coalesce(business_address, 'Wholesale Market, Peshawar (demo address)'),
    invoice_footer = coalesce(invoice_footer, 'Thank you for your business. Goods once delivered are checked at delivery.')
    where id = 1`;

  // Admin (only if none exists yet)
  const [{ admins }] = await sql<any[]>`select count(*) as admins from app_users where role = 'admin'`;
  let adminId: string;
  if (admins === 0) {
    const [u] = await sql<any[]>`insert into app_users (role, full_name, phone, status, language)
      values ('admin', ${DEMO_ADMIN.name}, ${DEMO_ADMIN.phone}, 'active', 'en') returning id`;
    await sql`insert into auth_credentials (user_id, password_hash) values (${u.id}, ${await hashPassword(DEMO_ADMIN.password)})`;
    adminId = u.id;
  } else {
    [{ id: adminId }] = await sql<any[]>`select id from app_users where role = 'admin' and status = 'active' order by created_at limit 1`;
  }

  // Categories + products
  const catIds: Record<string, string> = {};
  for (const [i, c] of CATEGORIES.entries()) {
    const [row] = await sql<any[]>`insert into categories (name_en, name_ur, sort_order) values (${c.en}, ${c.ur}, ${i * 10})
      on conflict ((lower(name_en))) do update set name_ur = excluded.name_ur returning id`;
    catIds[c.en] = row.id;
  }
  const products: { id: string; price: number }[] = [];
  let skuN = 100;
  for (const c of CATEGORIES) {
    for (const [en, ur] of ITEMS[c.en]) {
      for (const size of SIZES) {
        skuN++;
        const sku = `${c.en.slice(0, 3).toUpperCase().replace(/[^A-Z]/g, 'X')}-${skuN}`;
        const nameEn = `${en} ${size.en}`;
        const nameUr = `${ur} ${size.ur}`;
        const base = 400 + Math.round(r() * 2600);
        const price = Math.round((base * size.factor) / 10) * 10;
        const roll = r();
        const stock = roll < 0.06 ? 0 : roll < 0.14 ? 1 + Math.floor(r() * 4) : 10 + Math.floor(r() * 90);
        const svg = productSvg(nameEn, c.en, c.color, c.icon, sku);
        const buf = Buffer.from(svg, 'utf8');
        const [p] = await sql<any[]>`insert into products (sku, name_en, name_ur, category_id, unit_type, unit_label_en, unit_label_ur,
            pieces_per_unit, price, stock_qty, low_stock_threshold, sort_order, description_en, description_ur)
          values (${sku}, ${nameEn}, ${nameUr}, ${catIds[c.en]}, ${size.unit[0]}, ${size.unit[1]}, ${size.unit[2]}, ${size.per},
            ${price}, ${stock}, 5, ${skuN}, ${`${size.per} packs per ${size.unit[1].toLowerCase()}`}, ${`فی ${size.unit[2]} ${size.per} پیک`})
          on conflict ((upper(sku))) do nothing returning id`;
        if (!p) continue;
        const [img] = await sql<any[]>`insert into product_images (product_id, content_type, data, byte_size)
          values (${p.id}, 'image/svg+xml', ${buf}, ${buf.length}) returning id`;
        await sql`update products set image_id = ${img.id} where id = ${p.id}`;
        if (stock > 0) await sql`insert into inventory_movements (product_id, change, stock_after, reason, actor_id, note)
          values (${p.id}, ${stock}, ${stock}, 'initial', ${adminId}, 'Demo opening stock')`;
        products.push({ id: p.id, price });
      }
    }
  }
  // Make a few products archived / inactive so those states are visible.
  await sql`update products set is_active = false where sku in (select sku from products order by sku limit 2)`;

  // Shops
  const shopIds: { id: string; userId: string; status: string }[] = [];
  for (const s of DEMO_SHOPS) {
    const [u] = await sql<any[]>`insert into app_users (role, full_name, phone, status, language)
      values ('shopkeeper', ${s.name}, ${s.phone}, ${s.status}, ${s.lang}) on conflict (phone) do nothing returning id`;
    if (!u) continue;
    await sql`insert into auth_credentials (user_id, password_hash) values (${u.id}, ${await hashPassword(s.password)})`;
    const [shop] = await sql<any[]>`insert into shops (owner_user_id, name, address, approved_at, approved_by)
      values (${u.id}, ${s.shop}, ${'Main Bazaar, Peshawar (demo)'}, ${s.status === 'active' ? new Date() : null}, ${s.status === 'active' ? adminId : null})
      returning id`;
    shopIds.push({ id: shop.id, userId: u.id, status: s.status });
  }

  // Order history over the last ~4 weeks, created through the real order functions.
  const active = shopIds.filter((s) => s.status === 'active');
  const orderable = await sql<any[]>`select id from products where is_active and archived_at is null and stock_qty >= 20 order by sku`;
  let made = 0;
  for (const [si, shop] of active.entries()) {
    const dayOffsets = si === 0 ? [27, 20, 13, 6] : si === 1 ? [22, 15, 8, 3, 1] : [25, 11, 4];
    for (const [k, daysAgo] of dayOffsets.entries()) {
      const n = 3 + Math.floor(r() * 6);
      const picks = new Set<string>();
      while (picks.size < n) picks.add(orderable[Math.floor(r() * orderable.length)].id);
      const items = [...picks].map((id) => ({ product_id: id, qty: 1 + Math.floor(r() * 6) }));
      const orderId = await asUser(sql, shop.userId, async (tx) => {
        const [{ id }] = await tx<any[]>`select place_order(${tx.json(items as any)}, ${k === 0 ? 'Please deliver before noon' : null}) as id`;
        return id as string;
      });
      const newest = k === dayOffsets.length - 1;
      const target = newest && si < 2 ? (si === 0 ? 'submitted' : 'checking') : daysAgo > 7 ? 'delivered' : 'confirmed';
      if (target !== 'submitted') {
        await asUser(sql, adminId, async (tx) => {
          const lines = await tx<any[]>`select id, requested_qty from order_items where order_id = ${orderId} order by line_no`;
          await reviewOrder(tx, adminId, orderId, {
            items: lines.map((l, i) => ({ id: l.id, approved_qty: i === 1 && r() < 0.5 ? Math.max(0, l.requested_qty - 2) : l.requested_qty,
              customer_note: i === 1 ? 'Limited stock today' : null })),
          });
          if (target === 'checking') return;
          await changeStatus(tx, adminId, orderId, 'confirmed', null);
          await generateInvoice(tx, adminId, orderId);
          if (target === 'delivered') await changeStatus(tx, adminId, orderId, 'delivered', 'Delivered');
        });
      }
      // Backdate the demo order so history/reports look realistic.
      const shift = `${daysAgo} days`;
      await sql`update orders set submitted_at = submitted_at - ${shift}::interval,
        confirmed_at = confirmed_at - ${shift}::interval, delivered_at = delivered_at - ${shift}::interval + interval '1 day'
        where id = ${orderId}`;
      await sql`update order_status_history set changed_at = changed_at - ${shift}::interval where order_id = ${orderId}`;
      await sql`update invoices set issue_date = issue_date - ${daysAgo}::int, created_at = created_at - ${shift}::interval where order_id = ${orderId}`;
      await sql`update ledger_entries set entry_date = entry_date - ${daysAgo}::int, created_at = created_at - ${shift}::interval
        where invoice_id in (select id from invoices where order_id = ${orderId})`;
      await sql`update inventory_movements set created_at = created_at - ${shift}::interval where order_id = ${orderId}`;
      made++;
    }
  }
  // A few payments
  for (const [i, shop] of active.slice(0, 4).entries()) {
    const [{ bal }] = await sql<any[]>`select coalesce(sum(debit - credit), 0) as bal from ledger_entries where shop_id = ${shop.id}`;
    if (bal <= 0) continue;
    const amount = Math.round((bal * (i === 0 ? 0.5 : i === 1 ? 1 : 0.3)) / 100) * 100;
    if (amount <= 0) continue;
    await sql`insert into ledger_entries (shop_id, entry_date, kind, credit, payment_method, reference, note, created_by)
      values (${shop.id}, current_date - ${5 - i}::int, 'payment', ${amount}, ${i % 2 ? 'bank' : 'cash'}, ${'RCPT-' + (1001 + i)}, 'Demo payment', ${adminId})`;
  }
  log('info', 'demo_seeded', { products: products.length, shops: shopIds.length, orders: made });
  return { seeded: true, products: products.length, shops: shopIds.length, orders: made };
}
