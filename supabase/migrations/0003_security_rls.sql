-- 0003 Row Level Security, helper functions, protective triggers and grants.
--
-- Model:
--   * admin       = app_users.role = 'admin'      AND status = 'active'
--   * shopkeeper  = app_users.role = 'shopkeeper' AND status = 'active', owning one shop
--   * pending / inactive accounts match no policy at all (they see nothing).
-- Every business table has RLS enabled. The `authenticated` role only gets rows a
-- policy allows. `anon` gets nothing.

CREATE OR REPLACE FUNCTION is_admin() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM app_users WHERE id = auth.uid() AND role = 'admin' AND status = 'active'
  )
$$;

CREATE OR REPLACE FUNCTION my_shop_id() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT s.id FROM shops s JOIN app_users u ON u.id = s.owner_user_id
  WHERE u.id = auth.uid() AND u.role = 'shopkeeper' AND u.status = 'active'
$$;

REVOKE ALL ON FUNCTION is_admin() FROM PUBLIC;
REVOKE ALL ON FUNCTION my_shop_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION is_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION my_shop_id() TO authenticated;

-- ---------------------------------------------------------------- updated_at
CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS app_users_touch ON app_users;
CREATE TRIGGER app_users_touch BEFORE UPDATE ON app_users FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
DROP TRIGGER IF EXISTS shops_touch ON shops;
CREATE TRIGGER shops_touch BEFORE UPDATE ON shops FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
DROP TRIGGER IF EXISTS products_touch ON products;
CREATE TRIGGER products_touch BEFORE UPDATE ON products FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
DROP TRIGGER IF EXISTS orders_touch ON orders;
CREATE TRIGGER orders_touch BEFORE UPDATE ON orders FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ------------------------------------------------- protect identity columns
-- Requests run as `authenticated`. Nobody can change a role through it, admins
-- can only create shopkeepers, and a shopkeeper may change preferences only.
-- NOTE: must be SECURITY INVOKER. Under SECURITY DEFINER, current_user would be
-- the function owner and every request would look "trusted" (caught by tests/integration/rls.test.ts).
CREATE OR REPLACE FUNCTION protect_app_users() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
BEGIN
  IF current_user <> 'authenticated' THEN
    RETURN NEW;   -- trusted server/system connection (migrations, bootstrap, sign-in)
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.role <> 'shopkeeper' THEN
      RAISE EXCEPTION 'role_not_allowed' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.role IS DISTINCT FROM OLD.role THEN
    RAISE EXCEPTION 'role_change_not_allowed' USING ERRCODE = '42501';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.last_login_at IS DISTINCT FROM OLD.last_login_at THEN
    RAISE EXCEPTION 'protected_field' USING ERRCODE = '42501';
  END IF;
  IF NOT is_admin() THEN
    IF NEW.full_name IS DISTINCT FROM OLD.full_name
       OR NEW.phone IS DISTINCT FROM OLD.phone
       OR NEW.status IS DISTINCT FROM OLD.status THEN
      RAISE EXCEPTION 'protected_field' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS app_users_protect ON app_users;
CREATE TRIGGER app_users_protect BEFORE INSERT OR UPDATE ON app_users
  FOR EACH ROW EXECUTE FUNCTION protect_app_users();

-- ------------------------------------------------------------- enable RLS
ALTER TABLE app_settings          ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_users             ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth_credentials      ENABLE ROW LEVEL SECURITY;
ALTER TABLE shops                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE categories            ENABLE ROW LEVEL SECURITY;
ALTER TABLE products              ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_images        ENABLE ROW LEVEL SECURITY;
ALTER TABLE favourites            ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders                ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_items           ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_status_history  ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_internal_notes  ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices              ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_items         ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_movements   ENABLE ROW LEVEL SECURITY;
ALTER TABLE ledger_entries        ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications         ENABLE ROW LEVEL SECURITY;
ALTER TABLE reminder_log          ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log             ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------- grants
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;
REVOKE ALL ON auth_credentials FROM authenticated;

GRANT SELECT, UPDATE ON app_settings TO authenticated;
GRANT SELECT, INSERT, UPDATE ON app_users TO authenticated;
GRANT SELECT, INSERT, UPDATE ON shops TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON categories TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON products TO authenticated;
GRANT SELECT, INSERT, DELETE ON product_images TO authenticated;
GRANT SELECT, INSERT, DELETE ON favourites TO authenticated;
GRANT SELECT, UPDATE ON orders TO authenticated;
GRANT SELECT, INSERT, UPDATE ON order_items TO authenticated;
GRANT SELECT, INSERT ON order_status_history TO authenticated;
GRANT SELECT, INSERT ON order_internal_notes TO authenticated;
GRANT SELECT, INSERT, UPDATE ON invoices TO authenticated;
GRANT SELECT, INSERT ON invoice_items TO authenticated;
GRANT SELECT, INSERT ON inventory_movements TO authenticated;
GRANT SELECT, INSERT ON ledger_entries TO authenticated;
GRANT SELECT, INSERT ON notifications TO authenticated;
GRANT UPDATE (read_at) ON notifications TO authenticated;
GRANT SELECT, INSERT ON reminder_log TO authenticated;
GRANT SELECT, INSERT ON audit_log TO authenticated;
GRANT USAGE ON SEQUENCE audit_log_id_seq TO authenticated;
GRANT USAGE ON SEQUENCE invoice_no_seq TO authenticated;

-- --------------------------------------------------------------- policies
-- Helper macro-like naming: <table>_<who>_<what>
DROP POLICY IF EXISTS app_settings_read ON app_settings;
CREATE POLICY app_settings_read ON app_settings FOR SELECT TO authenticated
  USING (is_admin() OR my_shop_id() IS NOT NULL);
DROP POLICY IF EXISTS app_settings_admin_update ON app_settings;
CREATE POLICY app_settings_admin_update ON app_settings FOR UPDATE TO authenticated
  USING (is_admin()) WITH CHECK (is_admin());

DROP POLICY IF EXISTS app_users_read ON app_users;
CREATE POLICY app_users_read ON app_users FOR SELECT TO authenticated
  USING (id = auth.uid() OR is_admin());
DROP POLICY IF EXISTS app_users_update ON app_users;
CREATE POLICY app_users_update ON app_users FOR UPDATE TO authenticated
  USING ((id = auth.uid() AND status = 'active') OR is_admin())
  WITH CHECK ((id = auth.uid() AND status = 'active') OR is_admin());
DROP POLICY IF EXISTS app_users_admin_insert ON app_users;
CREATE POLICY app_users_admin_insert ON app_users FOR INSERT TO authenticated
  WITH CHECK (is_admin());

DROP POLICY IF EXISTS shops_read ON shops;
CREATE POLICY shops_read ON shops FOR SELECT TO authenticated
  USING (id = my_shop_id() OR is_admin());
DROP POLICY IF EXISTS shops_admin_insert ON shops;
CREATE POLICY shops_admin_insert ON shops FOR INSERT TO authenticated WITH CHECK (is_admin());
DROP POLICY IF EXISTS shops_admin_update ON shops;
CREATE POLICY shops_admin_update ON shops FOR UPDATE TO authenticated
  USING (is_admin()) WITH CHECK (is_admin());

DROP POLICY IF EXISTS categories_read ON categories;
CREATE POLICY categories_read ON categories FOR SELECT TO authenticated
  USING (is_admin() OR (is_active AND my_shop_id() IS NOT NULL));
DROP POLICY IF EXISTS categories_admin_write ON categories;
CREATE POLICY categories_admin_write ON categories FOR ALL TO authenticated
  USING (is_admin()) WITH CHECK (is_admin());

-- Products table (stock, thresholds, raw price) is admin only. Shopkeepers read
-- the customer-safe `catalogue_products` view below.
DROP POLICY IF EXISTS products_admin_all ON products;
CREATE POLICY products_admin_all ON products FOR ALL TO authenticated
  USING (is_admin()) WITH CHECK (is_admin());

DROP POLICY IF EXISTS product_images_read ON product_images;
CREATE POLICY product_images_read ON product_images FOR SELECT TO authenticated
  USING (is_admin() OR my_shop_id() IS NOT NULL);
DROP POLICY IF EXISTS product_images_admin_insert ON product_images;
CREATE POLICY product_images_admin_insert ON product_images FOR INSERT TO authenticated WITH CHECK (is_admin());
DROP POLICY IF EXISTS product_images_admin_delete ON product_images;
CREATE POLICY product_images_admin_delete ON product_images FOR DELETE TO authenticated USING (is_admin());

DROP POLICY IF EXISTS favourites_own ON favourites;
CREATE POLICY favourites_own ON favourites FOR ALL TO authenticated
  USING (shop_id = my_shop_id()) WITH CHECK (shop_id = my_shop_id());
DROP POLICY IF EXISTS favourites_admin_read ON favourites;
CREATE POLICY favourites_admin_read ON favourites FOR SELECT TO authenticated USING (is_admin());

-- Orders: shops read their own; only admins update. Shops create orders through
-- place_order() (0004), which validates quantities and snapshots prices.
DROP POLICY IF EXISTS orders_read ON orders;
CREATE POLICY orders_read ON orders FOR SELECT TO authenticated
  USING (shop_id = my_shop_id() OR is_admin());
DROP POLICY IF EXISTS orders_admin_update ON orders;
CREATE POLICY orders_admin_update ON orders FOR UPDATE TO authenticated
  USING (is_admin()) WITH CHECK (is_admin());

DROP POLICY IF EXISTS order_items_read ON order_items;
CREATE POLICY order_items_read ON order_items FOR SELECT TO authenticated
  USING (is_admin() OR EXISTS (SELECT 1 FROM orders o WHERE o.id = order_id AND o.shop_id = my_shop_id()));
DROP POLICY IF EXISTS order_items_admin_write ON order_items;
CREATE POLICY order_items_admin_write ON order_items FOR INSERT TO authenticated WITH CHECK (is_admin());
DROP POLICY IF EXISTS order_items_admin_update ON order_items;
CREATE POLICY order_items_admin_update ON order_items FOR UPDATE TO authenticated
  USING (is_admin()) WITH CHECK (is_admin());

DROP POLICY IF EXISTS order_status_history_read ON order_status_history;
CREATE POLICY order_status_history_read ON order_status_history FOR SELECT TO authenticated
  USING (is_admin() OR EXISTS (SELECT 1 FROM orders o WHERE o.id = order_id AND o.shop_id = my_shop_id()));
DROP POLICY IF EXISTS order_status_history_admin_insert ON order_status_history;
CREATE POLICY order_status_history_admin_insert ON order_status_history FOR INSERT TO authenticated
  WITH CHECK (is_admin());

DROP POLICY IF EXISTS order_internal_notes_admin ON order_internal_notes;
CREATE POLICY order_internal_notes_admin ON order_internal_notes FOR ALL TO authenticated
  USING (is_admin()) WITH CHECK (is_admin());

DROP POLICY IF EXISTS invoices_read ON invoices;
CREATE POLICY invoices_read ON invoices FOR SELECT TO authenticated
  USING (shop_id = my_shop_id() OR is_admin());
DROP POLICY IF EXISTS invoices_admin_insert ON invoices;
CREATE POLICY invoices_admin_insert ON invoices FOR INSERT TO authenticated WITH CHECK (is_admin());
DROP POLICY IF EXISTS invoices_admin_update ON invoices;
CREATE POLICY invoices_admin_update ON invoices FOR UPDATE TO authenticated
  USING (is_admin()) WITH CHECK (is_admin());

DROP POLICY IF EXISTS invoice_items_read ON invoice_items;
CREATE POLICY invoice_items_read ON invoice_items FOR SELECT TO authenticated
  USING (is_admin() OR EXISTS (SELECT 1 FROM invoices i WHERE i.id = invoice_id AND i.shop_id = my_shop_id()));
DROP POLICY IF EXISTS invoice_items_admin_insert ON invoice_items;
CREATE POLICY invoice_items_admin_insert ON invoice_items FOR INSERT TO authenticated WITH CHECK (is_admin());

DROP POLICY IF EXISTS inventory_movements_admin ON inventory_movements;
CREATE POLICY inventory_movements_admin ON inventory_movements FOR ALL TO authenticated
  USING (is_admin()) WITH CHECK (is_admin());

DROP POLICY IF EXISTS ledger_entries_read ON ledger_entries;
CREATE POLICY ledger_entries_read ON ledger_entries FOR SELECT TO authenticated
  USING (shop_id = my_shop_id() OR is_admin());
DROP POLICY IF EXISTS ledger_entries_admin_insert ON ledger_entries;
CREATE POLICY ledger_entries_admin_insert ON ledger_entries FOR INSERT TO authenticated WITH CHECK (is_admin());

DROP POLICY IF EXISTS notifications_own_read ON notifications;
CREATE POLICY notifications_own_read ON notifications FOR SELECT TO authenticated
  USING ((user_id = auth.uid() AND (is_admin() OR my_shop_id() IS NOT NULL)) OR is_admin());
DROP POLICY IF EXISTS notifications_own_update ON notifications;
CREATE POLICY notifications_own_update ON notifications FOR UPDATE TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS notifications_admin_insert ON notifications;
CREATE POLICY notifications_admin_insert ON notifications FOR INSERT TO authenticated WITH CHECK (is_admin());

DROP POLICY IF EXISTS reminder_log_admin ON reminder_log;
CREATE POLICY reminder_log_admin ON reminder_log FOR ALL TO authenticated
  USING (is_admin()) WITH CHECK (is_admin());

DROP POLICY IF EXISTS audit_log_admin ON audit_log;
CREATE POLICY audit_log_admin ON audit_log FOR ALL TO authenticated
  USING (is_admin()) WITH CHECK (is_admin());

-- --------------------------------------------------- customer-safe views
-- Runs with the view owner's rights on purpose: it exposes only active, unarchived
-- products and hides stock numbers, thresholds and (when disabled) prices.
CREATE OR REPLACE VIEW catalogue_products AS
SELECT p.id, p.sku, p.name_en, p.name_ur, p.description_en, p.description_ur,
       p.category_id, p.unit_type, p.unit_label_en, p.unit_label_ur, p.pieces_per_unit,
       p.image_id, p.sort_order, p.updated_at,
       CASE WHEN s.show_prices AND p.show_price THEN p.price END AS price,
       CASE WHEN p.stock_qty <= 0 THEN 'out'
            WHEN p.stock_qty <= p.low_stock_threshold THEN 'low'
            ELSE 'in' END AS availability
FROM products p CROSS JOIN app_settings s
WHERE p.is_active AND p.archived_at IS NULL
  AND (my_shop_id() IS NOT NULL OR is_admin());
REVOKE ALL ON catalogue_products FROM PUBLIC, anon;
GRANT SELECT ON catalogue_products TO authenticated;

-- Running balance per shop; security_invoker so ledger RLS applies.
CREATE OR REPLACE VIEW shop_balances WITH (security_invoker = true) AS
SELECT shop_id, sum(debit) AS total_debit, sum(credit) AS total_credit,
       sum(debit) - sum(credit) AS balance, max(entry_date) AS last_entry_date
FROM ledger_entries GROUP BY shop_id;
REVOKE ALL ON shop_balances FROM PUBLIC, anon;
GRANT SELECT ON shop_balances TO authenticated;
