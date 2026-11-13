-- 0004 Functions shopkeepers call to change data. They run with owner rights but
-- check the caller themselves, so a shop cannot write prices, other shops' ids,
-- statuses or invalid quantities, whatever the client sends.

CREATE OR REPLACE FUNCTION place_order(p_items jsonb, p_note text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_shop      uuid := my_shop_id();
  v_user      uuid := auth.uid();
  v_settings  app_settings;
  v_shop_row  shops;
  v_user_row  app_users;
  v_order     uuid;
  v_ref       text;
  v_n         int;
  v_bad       text;
  v_qty_total int;
  v_has_null  boolean;
  v_total     numeric(12,2);
BEGIN
  IF v_shop IS NULL THEN
    RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501';
  END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'empty_cart' USING ERRCODE = '22023';
  END IF;
  v_n := jsonb_array_length(p_items);
  IF v_n > 250 THEN
    RAISE EXCEPTION 'too_many_items' USING ERRCODE = '22023';
  END IF;
  IF p_note IS NOT NULL AND length(p_note) > 300 THEN
    RAISE EXCEPTION 'note_too_long' USING ERRCODE = '22023';
  END IF;

  -- shape + quantity validation
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_items) e
    WHERE jsonb_typeof(e) <> 'object'
       OR jsonb_typeof(e -> 'product_id') <> 'string'
       OR NOT ((e ->> 'product_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
  ) THEN
    RAISE EXCEPTION 'invalid_item' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_items) e
    WHERE CASE WHEN jsonb_typeof(e -> 'qty') = 'number' THEN
            (e ->> 'qty')::numeric <> trunc((e ->> 'qty')::numeric)
            OR (e ->> 'qty')::numeric < 1
            OR (e ->> 'qty')::numeric > 999
          ELSE true END
  ) THEN
    RAISE EXCEPTION 'invalid_quantity' USING ERRCODE = '22023';
  END IF;
  IF (SELECT count(DISTINCT lower(e ->> 'product_id')) FROM jsonb_array_elements(p_items) e) <> v_n THEN
    RAISE EXCEPTION 'duplicate_item' USING ERRCODE = '22023';
  END IF;

  -- every product must exist, be active, unarchived and in stock right now
  SELECT e ->> 'product_id' INTO v_bad
  FROM jsonb_array_elements(p_items) e
  LEFT JOIN products p ON p.id = (e ->> 'product_id')::uuid
    AND p.is_active AND p.archived_at IS NULL AND p.stock_qty > 0
  WHERE p.id IS NULL
  LIMIT 1;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'product_unavailable:%', v_bad USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_settings FROM app_settings WHERE id = 1;
  SELECT * INTO v_shop_row FROM shops WHERE id = v_shop;
  SELECT * INTO v_user_row FROM app_users WHERE id = v_user;

  v_ref := 'KG-' || to_char(now() AT TIME ZONE v_settings.timezone, 'YYMMDD') || '-'
           || lpad(nextval('order_ref_seq')::text, 4, '0');

  INSERT INTO orders (ref, shop_id, placed_by, status, customer_note, shop_name_snapshot,
                      customer_name_snapshot, customer_phone_snapshot, prices_visible, currency,
                      item_count, total_requested_qty)
  VALUES (v_ref, v_shop, v_user, 'submitted', nullif(btrim(p_note), ''), v_shop_row.name,
          v_user_row.full_name, v_user_row.phone, v_settings.show_prices, v_settings.currency, v_n, 0)
  RETURNING id INTO v_order;

  INSERT INTO order_items (order_id, line_no, product_id, sku_snapshot, name_en_snapshot, name_ur_snapshot,
                           unit_label_en_snapshot, unit_label_ur_snapshot, unit_price_snapshot, requested_qty)
  SELECT v_order, row_number() OVER (ORDER BY e.ord), p.id, p.sku, p.name_en, p.name_ur,
         p.unit_label_en, p.unit_label_ur, p.price, (e.val ->> 'qty')::int
  FROM jsonb_array_elements(p_items) WITH ORDINALITY AS e(val, ord)
  JOIN products p ON p.id = (e.val ->> 'product_id')::uuid;

  SELECT sum(requested_qty), bool_or(unit_price_snapshot IS NULL),
         sum(requested_qty * coalesce(unit_price_snapshot, 0))
    INTO v_qty_total, v_has_null, v_total
  FROM order_items WHERE order_id = v_order;

  UPDATE orders SET total_requested_qty = v_qty_total,
                    requested_total = CASE WHEN v_has_null THEN NULL ELSE v_total END
  WHERE id = v_order;

  INSERT INTO order_status_history (order_id, from_status, to_status, changed_by)
  VALUES (v_order, NULL, 'submitted', v_user);

  RETURN v_order;
END $$;

-- A shop may cancel its own order only before the business starts working on it.
CREATE OR REPLACE FUNCTION cancel_my_order(p_order uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_shop uuid := my_shop_id();
  v_status text;
BEGIN
  IF v_shop IS NULL THEN
    RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501';
  END IF;
  SELECT status INTO v_status FROM orders WHERE id = p_order AND shop_id = v_shop FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_status <> 'submitted' THEN
    RAISE EXCEPTION 'cannot_cancel' USING ERRCODE = '22023';
  END IF;
  UPDATE orders SET status = 'cancelled', cancelled_at = now() WHERE id = p_order;
  INSERT INTO order_status_history (order_id, from_status, to_status, note, changed_by)
  VALUES (p_order, v_status, 'cancelled', 'Cancelled by shop', auth.uid());
END $$;

-- Records that the shop pressed "Send on WhatsApp" (it does NOT prove delivery).
CREATE OR REPLACE FUNCTION mark_order_whatsapp_opened(p_order uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF my_shop_id() IS NULL THEN
    RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501';
  END IF;
  UPDATE orders SET whatsapp_opened_at = coalesce(whatsapp_opened_at, now())
  WHERE id = p_order AND shop_id = my_shop_id();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
  END IF;
END $$;

REVOKE ALL ON FUNCTION place_order(jsonb, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION cancel_my_order(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION mark_order_whatsapp_opened(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION place_order(jsonb, text) TO authenticated;
GRANT EXECUTE ON FUNCTION cancel_my_order(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION mark_order_whatsapp_opened(uuid) TO authenticated;
