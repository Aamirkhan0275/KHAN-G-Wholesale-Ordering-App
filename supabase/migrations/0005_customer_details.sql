-- 0005 Fuller customer (shop) records + admin-only notes / credit limit.

ALTER TABLE shops ADD COLUMN IF NOT EXISTS city            text;
ALTER TABLE shops ADD COLUMN IF NOT EXISTS area            text;
ALTER TABLE shops ADD COLUMN IF NOT EXISTS alternate_phone text;
ALTER TABLE shops ADD COLUMN IF NOT EXISTS whatsapp_phone  text;
ALTER TABLE shops ADD COLUMN IF NOT EXISTS email           text;
ALTER TABLE shops ADD COLUMN IF NOT EXISTS cnic            text;
ALTER TABLE shops ADD COLUMN IF NOT EXISTS ntn             text;
ALTER TABLE shops ADD COLUMN IF NOT EXISTS shop_type       text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'shops_details_check') THEN
    ALTER TABLE shops ADD CONSTRAINT shops_details_check CHECK (
      (city IS NULL OR length(city) <= 60) AND
      (area IS NULL OR length(area) <= 80) AND
      (alternate_phone IS NULL OR alternate_phone ~ '^\+[1-9][0-9]{7,14}$') AND
      (whatsapp_phone IS NULL OR whatsapp_phone ~ '^\+[1-9][0-9]{7,14}$') AND
      (email IS NULL OR (length(email) <= 120 AND email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')) AND
      (cnic IS NULL OR cnic ~ '^[0-9]{5}-[0-9]{7}-[0-9]$') AND
      (ntn IS NULL OR length(ntn) <= 20) AND
      (shop_type IS NULL OR length(shop_type) <= 40)
    );
  END IF;
END $$;

-- Admin-only facts about a customer. A shop can read its own `shops` row, so private
-- notes live in a separate table that only admins can see.
CREATE TABLE IF NOT EXISTS shop_admin_details (
  shop_id       uuid PRIMARY KEY REFERENCES shops (id) ON DELETE CASCADE,
  notes         text CHECK (notes IS NULL OR length(notes) <= 1000),
  credit_limit  numeric(12,2) CHECK (credit_limit IS NULL OR credit_limit >= 0),
  updated_by    uuid REFERENCES app_users (id),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE shop_admin_details ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON shop_admin_details FROM anon;
GRANT SELECT, INSERT, UPDATE ON shop_admin_details TO authenticated;
DROP POLICY IF EXISTS shop_admin_details_admin ON shop_admin_details;
CREATE POLICY shop_admin_details_admin ON shop_admin_details FOR ALL TO authenticated
  USING (is_admin()) WITH CHECK (is_admin());

CREATE INDEX IF NOT EXISTS shops_city_idx ON shops (lower(city));
