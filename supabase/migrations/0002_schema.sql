-- 0002 Core relational schema for KHAN G Wholesale Ordering App
-- Money is numeric(12,2) in the configured currency (PKR by default).
-- Quantities are whole units (cartons/boxes by default; see products.unit_type).

CREATE TABLE IF NOT EXISTS app_settings (
  id                 int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  business_name      text NOT NULL DEFAULT 'KHAN G',
  business_name_ur   text,
  business_phone     text,
  business_whatsapp  text,           -- E.164 without spaces, e.g. +923001234567
  business_address   text,
  business_email     text,
  invoice_footer     text,
  currency           text NOT NULL DEFAULT 'PKR',
  show_prices        boolean NOT NULL DEFAULT true,  -- global customer price visibility
  timezone           text NOT NULL DEFAULT 'Asia/Karachi',
  reminders_enabled  boolean NOT NULL DEFAULT true,
  reminder_time      time NOT NULL DEFAULT '10:00',
  reminder_rule      text NOT NULL DEFAULT 'latest_order' CHECK (reminder_rule IN ('latest_order', 'fixed')),
  reminder_default_weekday smallint CHECK (reminder_default_weekday BETWEEN 0 AND 6), -- 0 = Sunday
  low_stock_default  int NOT NULL DEFAULT 5 CHECK (low_stock_default >= 0),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

-- Identity/profile of a person who can sign in. Credentials live separately.
CREATE TABLE IF NOT EXISTS app_users (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  role               text NOT NULL CHECK (role IN ('admin', 'shopkeeper')),
  full_name          text NOT NULL CHECK (length(btrim(full_name)) BETWEEN 2 AND 80),
  phone              text NOT NULL CHECK (phone ~ '^\+[1-9][0-9]{7,14}$'),
  status             text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'inactive')),
  language           text NOT NULL DEFAULT 'ur' CHECK (language IN ('en', 'ur')),
  theme              text NOT NULL DEFAULT 'system' CHECK (theme IN ('system', 'light', 'dark')),
  reminders_opt_out  boolean NOT NULL DEFAULT false,
  last_login_at      timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
-- One account per normalized mobile number (prevents duplicate active accounts).
CREATE UNIQUE INDEX IF NOT EXISTS app_users_phone_key ON app_users (phone);

-- Password hashes and lockout counters. No policy grants access to these rows:
-- only the server's system connection reads them during sign-in.
CREATE TABLE IF NOT EXISTS auth_credentials (
  user_id               uuid PRIMARY KEY REFERENCES app_users (id) ON DELETE CASCADE,
  password_hash         text NOT NULL,
  must_change_password  boolean NOT NULL DEFAULT false,
  failed_attempts       int NOT NULL DEFAULT 0,
  locked_until          timestamptz,
  password_changed_at   timestamptz NOT NULL DEFAULT now(),
  session_version       int NOT NULL DEFAULT 1   -- bump to sign out every session
);

CREATE TABLE IF NOT EXISTS shops (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id      uuid NOT NULL UNIQUE REFERENCES app_users (id) ON DELETE RESTRICT,
  name               text NOT NULL CHECK (length(btrim(name)) BETWEEN 2 AND 100),
  address            text CHECK (address IS NULL OR length(address) <= 300),
  location_note      text CHECK (location_note IS NULL OR length(location_note) <= 300),
  reminder_enabled   boolean NOT NULL DEFAULT true,    -- admin switch per shop
  reminder_weekday   smallint CHECK (reminder_weekday BETWEEN 0 AND 6), -- admin override (0 = Sunday)
  approved_at        timestamptz,
  approved_by        uuid REFERENCES app_users (id),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS categories (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name_en     text NOT NULL CHECK (length(btrim(name_en)) BETWEEN 1 AND 60),
  name_ur     text CHECK (name_ur IS NULL OR length(name_ur) <= 60),
  sort_order  int NOT NULL DEFAULT 0,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS categories_name_en_key ON categories (lower(name_en));

CREATE TABLE IF NOT EXISTS products (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sku                  text NOT NULL CHECK (sku ~ '^[A-Za-z0-9._-]{1,32}$'),
  name_en              text NOT NULL CHECK (length(btrim(name_en)) BETWEEN 2 AND 120),
  name_ur              text CHECK (name_ur IS NULL OR length(name_ur) <= 120),
  description_en       text CHECK (description_en IS NULL OR length(description_en) <= 500),
  description_ur       text CHECK (description_ur IS NULL OR length(description_ur) <= 500),
  category_id          uuid REFERENCES categories (id) ON DELETE SET NULL,
  unit_type            text NOT NULL DEFAULT 'carton' CHECK (unit_type IN ('carton', 'box', 'pack', 'dozen', 'piece')),
  unit_label_en        text NOT NULL DEFAULT 'Carton',
  unit_label_ur        text NOT NULL DEFAULT 'کارٹن',
  pieces_per_unit      int CHECK (pieces_per_unit IS NULL OR pieces_per_unit > 0),
  price                numeric(12,2) CHECK (price IS NULL OR price >= 0),
  show_price           boolean NOT NULL DEFAULT true,
  stock_qty            int NOT NULL DEFAULT 0,
  low_stock_threshold  int NOT NULL DEFAULT 5 CHECK (low_stock_threshold >= 0),
  is_active            boolean NOT NULL DEFAULT true,
  archived_at          timestamptz,
  sort_order           int NOT NULL DEFAULT 0,
  image_id             uuid,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS products_sku_key ON products (upper(sku));
CREATE INDEX IF NOT EXISTS products_category_idx ON products (category_id);

-- Photos are stored in the database (bytea) so the app runs on any PostgreSQL,
-- including Supabase free tier, without a separate storage bucket. The browser
-- resizes uploads to <= 800px JPEG/WebP first (typically 40-120 KB each).
CREATE TABLE IF NOT EXISTS product_images (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id    uuid REFERENCES products (id) ON DELETE CASCADE,
  content_type  text NOT NULL CHECK (content_type IN ('image/jpeg', 'image/png', 'image/webp', 'image/svg+xml')),
  data          bytea NOT NULL,
  byte_size     int NOT NULL CHECK (byte_size > 0 AND byte_size <= 2000000),
  uploaded_by   uuid REFERENCES app_users (id),
  created_at    timestamptz NOT NULL DEFAULT now()
);
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'products_image_fk') THEN
    ALTER TABLE products ADD CONSTRAINT products_image_fk
      FOREIGN KEY (image_id) REFERENCES product_images (id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS favourites (
  shop_id     uuid NOT NULL REFERENCES shops (id) ON DELETE CASCADE,
  product_id  uuid NOT NULL REFERENCES products (id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (shop_id, product_id)
);

CREATE SEQUENCE IF NOT EXISTS order_ref_seq START 1;
CREATE SEQUENCE IF NOT EXISTS invoice_no_seq START 1;

CREATE TABLE IF NOT EXISTS orders (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ref                      text NOT NULL UNIQUE,
  shop_id                  uuid NOT NULL REFERENCES shops (id) ON DELETE RESTRICT,
  placed_by                uuid NOT NULL REFERENCES app_users (id),
  status                   text NOT NULL DEFAULT 'submitted' CHECK (status IN (
                             'submitted', 'checking', 'needs_confirmation', 'confirmed',
                             'ready', 'delivered', 'cancelled')),
  customer_note            text CHECK (customer_note IS NULL OR length(customer_note) <= 300),
  shop_name_snapshot       text NOT NULL,
  customer_name_snapshot   text NOT NULL,
  customer_phone_snapshot  text NOT NULL,
  prices_visible           boolean NOT NULL,          -- customer price visibility at order time
  currency                 text NOT NULL,
  item_count               int NOT NULL,
  total_requested_qty      int NOT NULL,
  total_approved_qty       int,
  requested_total          numeric(12,2),            -- null if any line has no price
  approved_total           numeric(12,2),
  whatsapp_opened_at       timestamptz,
  stock_deducted_at        timestamptz,
  submitted_at             timestamptz NOT NULL DEFAULT now(),
  confirmed_at             timestamptz,
  delivered_at             timestamptz,
  cancelled_at             timestamptz,
  updated_at               timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS orders_shop_idx ON orders (shop_id, submitted_at DESC);
CREATE INDEX IF NOT EXISTS orders_status_idx ON orders (status, submitted_at DESC);

CREATE TABLE IF NOT EXISTS order_items (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id               uuid NOT NULL REFERENCES orders (id) ON DELETE CASCADE,
  line_no                int NOT NULL,
  product_id             uuid REFERENCES products (id) ON DELETE SET NULL,
  sku_snapshot           text NOT NULL,
  name_en_snapshot       text NOT NULL,
  name_ur_snapshot       text,
  unit_label_en_snapshot text NOT NULL,
  unit_label_ur_snapshot text NOT NULL,
  unit_price_snapshot    numeric(12,2),
  requested_qty          int NOT NULL CHECK (requested_qty >= 0 AND requested_qty <= 999),
  approved_qty           int CHECK (approved_qty IS NULL OR (approved_qty >= 0 AND approved_qty <= 999)),
  line_status            text NOT NULL DEFAULT 'pending' CHECK (line_status IN (
                           'pending', 'available', 'partial', 'unavailable', 'substituted', 'added')),
  substitute_for_item_id uuid REFERENCES order_items (id) ON DELETE SET NULL,
  customer_note          text CHECK (customer_note IS NULL OR length(customer_note) <= 200),
  reviewed_by            uuid REFERENCES app_users (id),
  reviewed_at            timestamptz,
  UNIQUE (order_id, line_no)
);
CREATE INDEX IF NOT EXISTS order_items_product_idx ON order_items (product_id);

CREATE TABLE IF NOT EXISTS order_status_history (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id             uuid NOT NULL REFERENCES orders (id) ON DELETE CASCADE,
  from_status          text,
  to_status            text NOT NULL,
  note                 text CHECK (note IS NULL OR length(note) <= 300),   -- shown to the shop
  changed_by           uuid REFERENCES app_users (id),
  changed_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS order_status_history_order_idx ON order_status_history (order_id, changed_at);

-- Internal notes: admin only, never shown to shopkeepers.
CREATE TABLE IF NOT EXISTS order_internal_notes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id    uuid NOT NULL REFERENCES orders (id) ON DELETE CASCADE,
  note        text NOT NULL CHECK (length(btrim(note)) BETWEEN 1 AND 1000),
  author_id   uuid REFERENCES app_users (id),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS invoices (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_no        text NOT NULL UNIQUE,
  order_id          uuid NOT NULL UNIQUE REFERENCES orders (id) ON DELETE RESTRICT,
  shop_id           uuid NOT NULL REFERENCES shops (id) ON DELETE RESTRICT,
  status            text NOT NULL DEFAULT 'issued' CHECK (status IN ('issued', 'void')),
  issue_date        date NOT NULL,
  currency          text NOT NULL,
  business_snapshot jsonb NOT NULL,
  shop_snapshot     jsonb NOT NULL,
  order_ref         text NOT NULL,
  subtotal          numeric(12,2) NOT NULL,
  total             numeric(12,2) NOT NULL,
  balance_before    numeric(12,2) NOT NULL,
  balance_after     numeric(12,2) NOT NULL,
  created_by        uuid REFERENCES app_users (id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  voided_at         timestamptz
);
CREATE INDEX IF NOT EXISTS invoices_shop_idx ON invoices (shop_id, issue_date DESC);

CREATE TABLE IF NOT EXISTS invoice_items (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id  uuid NOT NULL REFERENCES invoices (id) ON DELETE CASCADE,
  line_no     int NOT NULL,
  sku         text NOT NULL,
  name_en     text NOT NULL,
  name_ur     text,
  unit_label  text NOT NULL,
  qty         int NOT NULL CHECK (qty > 0),
  unit_price  numeric(12,2) NOT NULL,
  line_total  numeric(12,2) NOT NULL,
  UNIQUE (invoice_id, line_no)
);

CREATE TABLE IF NOT EXISTS inventory_movements (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id  uuid NOT NULL REFERENCES products (id) ON DELETE CASCADE,
  change      int NOT NULL CHECK (change <> 0),
  stock_after int NOT NULL,
  reason      text NOT NULL CHECK (reason IN ('initial', 'restock', 'adjustment', 'damage', 'return',
                                               'order_deduction', 'order_cancel_restore')),
  note        text CHECK (note IS NULL OR length(note) <= 300),
  order_id    uuid REFERENCES orders (id) ON DELETE SET NULL,
  actor_id    uuid REFERENCES app_users (id),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS inventory_movements_product_idx ON inventory_movements (product_id, created_at DESC);

-- Customer ledger. debit = amount the shop owes (invoice); credit = payment / reduction.
-- Balance = sum(debit) - sum(credit). Positive balance means the shop owes money.
CREATE TABLE IF NOT EXISTS ledger_entries (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id         uuid NOT NULL REFERENCES shops (id) ON DELETE RESTRICT,
  entry_date      date NOT NULL,
  kind            text NOT NULL CHECK (kind IN ('opening_balance', 'invoice', 'payment', 'adjustment', 'invoice_void')),
  debit           numeric(12,2) NOT NULL DEFAULT 0 CHECK (debit >= 0),
  credit          numeric(12,2) NOT NULL DEFAULT 0 CHECK (credit >= 0),
  invoice_id      uuid REFERENCES invoices (id) ON DELETE RESTRICT,
  payment_method  text CHECK (payment_method IS NULL OR payment_method IN ('cash', 'bank', 'mobile_wallet', 'cheque', 'other')),
  reference       text CHECK (reference IS NULL OR length(reference) <= 80),
  note            text CHECK (note IS NULL OR length(note) <= 300),
  created_by      uuid REFERENCES app_users (id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  CHECK ((debit > 0 AND credit = 0) OR (credit > 0 AND debit = 0))
);
CREATE INDEX IF NOT EXISTS ledger_entries_shop_idx ON ledger_entries (shop_id, entry_date, created_at);

CREATE TABLE IF NOT EXISTS notifications (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES app_users (id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN ('reorder_reminder', 'order_status', 'invoice', 'payment')),
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  link        text,
  read_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notifications_user_idx ON notifications (user_id, created_at DESC);

-- One row per shop per reminder cycle (ISO week in the business timezone).
CREATE TABLE IF NOT EXISTS reminder_log (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id          uuid NOT NULL REFERENCES shops (id) ON DELETE CASCADE,
  cycle_key        text NOT NULL,             -- e.g. 2026-W46
  weekday          smallint NOT NULL,
  status           text NOT NULL CHECK (status IN ('sent', 'skipped_already_ordered', 'skipped_opted_out', 'skipped_disabled')),
  notification_id  uuid REFERENCES notifications (id) ON DELETE SET NULL,
  details          jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (shop_id, cycle_key)
);

CREATE TABLE IF NOT EXISTS audit_log (
  id          bigserial PRIMARY KEY,
  actor_id    uuid REFERENCES app_users (id) ON DELETE SET NULL,
  action      text NOT NULL,
  entity      text NOT NULL,
  entity_id   text,
  details     jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);

INSERT INTO app_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
