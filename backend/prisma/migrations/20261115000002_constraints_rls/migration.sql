-- Constraints, indexes, row-level security and privileges that Prisma's schema language cannot express.
-- See docs/database-design.md §3 and §5. Every rule here has a test in test/db-constraints.spec.ts.

-- ───────── Tenant context helpers ─────────
CREATE FUNCTION app_org_id() RETURNS uuid LANGUAGE sql STABLE AS
  $$ SELECT nullif(current_setting('app.organization_id', true), '')::uuid $$;
CREATE FUNCTION app_user_id() RETURNS uuid LANGUAGE sql STABLE AS
  $$ SELECT nullif(current_setting('app.user_id', true), '')::uuid $$;

-- ───────── CHECK constraints ─────────
ALTER TABLE organizations
  ADD CONSTRAINT organizations_settings_chk CHECK (
    currency_exponent BETWEEN 0 AND 4 AND low_stock_threshold >= 0 AND max_markup_bp >= 0
    AND default_min_markup_bp >= 0 AND default_min_markup_bp <= default_markup_bp AND default_markup_bp <= max_markup_bp
    AND default_credit_days BETWEEN 0 AND 365 AND quotation_validity_days BETWEEN 1 AND 365);

ALTER TABLE tax_rates ADD CONSTRAINT tax_rates_rate_chk CHECK (rate_bp BETWEEN 0 AND 10000);

ALTER TABLE products
  ADD CONSTRAINT products_cost_chk CHECK (cost_minor >= 0),
  ADD CONSTRAINT products_markup_chk CHECK (min_markup_bp >= 0 AND min_markup_bp <= default_markup_bp),
  ADD CONSTRAINT products_reorder_chk CHECK (reorder_level IS NULL OR reorder_level >= 0),
  ADD CONSTRAINT products_weight_chk CHECK ((weight_value IS NULL) = (weight_unit IS NULL) AND (weight_value IS NULL OR weight_value > 0));

ALTER TABLE stock_levels ADD CONSTRAINT stock_levels_quantity_chk CHECK (quantity >= 0);

ALTER TABLE stock_movements
  ADD CONSTRAINT stock_movements_delta_chk CHECK (
    (type IN ('OPENING','PURCHASE_RECEIPT','SALE_CANCELLATION','CUSTOMER_RETURN','ADJUSTMENT_IN') AND quantity_delta > 0)
    OR (type IN ('SALE','ADJUSTMENT_OUT') AND quantity_delta < 0)),
  ADD CONSTRAINT stock_movements_balance_chk CHECK (balance_after >= 0),
  ADD CONSTRAINT stock_movements_cost_chk CHECK (unit_cost_minor >= 0),
  ADD CONSTRAINT stock_movements_reason_chk CHECK (
    type NOT IN ('ADJUSTMENT_IN','ADJUSTMENT_OUT') OR length(btrim(coalesce(reason, ''))) >= 3),
  ADD CONSTRAINT stock_movements_source_chk CHECK (
    (type IN ('SALE','SALE_CANCELLATION')) = (invoice_id IS NOT NULL)
    AND (type = 'CUSTOMER_RETURN') = (return_id IS NOT NULL));

ALTER TABLE customers ADD CONSTRAINT customers_identity_chk CHECK (
  length(btrim(coalesce(name, ''))) > 0 OR length(btrim(coalesce(company, ''))) > 0);

ALTER TABLE quotations ADD CONSTRAINT quotations_totals_chk CHECK (
  subtotal_minor >= 0 AND discount_minor >= 0 AND discount_minor <= subtotal_minor AND tax_minor >= 0
  AND total_minor = subtotal_minor - discount_minor + tax_minor AND tax_rate_bp BETWEEN 0 AND 10000);
ALTER TABLE quotation_items ADD CONSTRAINT quotation_items_chk CHECK (
  quantity > 0 AND unit_price_minor >= 0 AND unit_cost_minor >= 0 AND line_total_minor = unit_price_minor * quantity);

ALTER TABLE invoices
  ADD CONSTRAINT invoices_totals_chk CHECK (
    subtotal_minor >= 0 AND discount_minor >= 0 AND discount_minor <= subtotal_minor AND tax_minor >= 0
    AND total_minor = subtotal_minor - discount_minor + tax_minor AND tax_rate_bp BETWEEN 0 AND 10000 AND cost_minor >= 0),
  ADD CONSTRAINT invoices_settlement_chk CHECK (
    paid_minor >= 0 AND returned_minor >= 0 AND paid_minor + returned_minor <= total_minor),
  ADD CONSTRAINT invoices_cancel_chk CHECK ((status = 'CANCELLED') = (cancelled_at IS NOT NULL)),
  ADD CONSTRAINT invoices_credit_days_chk CHECK (credit_days IS NULL OR credit_days BETWEEN 0 AND 365);
ALTER TABLE invoice_items ADD CONSTRAINT invoice_items_chk CHECK (
  quantity > 0 AND unit_price_minor >= 0 AND unit_cost_minor >= 0 AND line_total_minor = unit_price_minor * quantity
  AND discount_alloc_minor >= 0 AND discount_alloc_minor <= line_total_minor AND tax_minor >= 0
  AND returned_quantity >= 0 AND returned_quantity <= quantity);

ALTER TABLE payments ADD CONSTRAINT payments_amount_chk CHECK (amount_minor > 0);
ALTER TABLE sales_returns ADD CONSTRAINT sales_returns_totals_chk CHECK (
  subtotal_minor >= 0 AND tax_minor >= 0 AND total_minor = subtotal_minor + tax_minor);
ALTER TABLE return_items ADD CONSTRAINT return_items_chk CHECK (quantity > 0 AND amount_minor >= 0 AND tax_minor >= 0);
ALTER TABLE document_sequences ADD CONSTRAINT document_sequences_chk CHECK (last_number >= 0 AND year BETWEEN 2000 AND 9999);

-- ───────── Uniqueness and search indexes ─────────
-- SKU is unique per organization regardless of case (the Prisma-generated index is case-sensitive).
CREATE UNIQUE INDEX products_org_sku_lower_key ON products (organization_id, lower(sku));
CREATE UNIQUE INDEX products_org_barcode_key ON products (organization_id, barcode) WHERE barcode IS NOT NULL;
CREATE UNIQUE INDEX branches_one_default_key ON branches (organization_id) WHERE is_default;
CREATE UNIQUE INDEX tax_rates_one_default_key ON tax_rates (organization_id) WHERE is_default;
CREATE INDEX products_name_trgm_idx ON products USING gin (name gin_trgm_ops);
CREATE INDEX products_sku_trgm_idx ON products USING gin (sku gin_trgm_ops);
CREATE INDEX customers_name_trgm_idx ON customers USING gin (name gin_trgm_ops);
CREATE INDEX customers_company_trgm_idx ON customers USING gin (company gin_trgm_ops);

-- ───────── Row-level security ─────────
-- The application connects as a non-owner role without BYPASSRLS; migrations run as the owner.
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON organizations USING (id = app_org_id()) WITH CHECK (id = app_org_id());

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['branches','tax_rates','products','stock_levels','stock_movements','customers',
                           'document_sequences','quotations','invoices','payments','sales_returns','idempotency_keys']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (organization_id = app_org_id()) WITH CHECK (organization_id = app_org_id())', t);
  END LOOP;
END $$;

-- Memberships: visible inside the tenant, and to the user they belong to (needed at login, before a tenant is chosen).
ALTER TABLE organization_members ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON organization_members
  USING (organization_id = app_org_id() OR user_id = app_user_id())
  WITH CHECK (organization_id = app_org_id());

-- Audit log: tenant rows are readable in the tenant; pre-tenant auth events (NULL organization) are insert-only.
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_read ON audit_logs FOR SELECT USING (organization_id = app_org_id());
CREATE POLICY tenant_insert ON audit_logs FOR INSERT WITH CHECK (organization_id IS NULL OR organization_id = app_org_id());

-- Line-item tables inherit isolation from their parent.
ALTER TABLE quotation_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON quotation_items
  USING (EXISTS (SELECT 1 FROM quotations q WHERE q.id = quotation_id AND q.organization_id = app_org_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM quotations q WHERE q.id = quotation_id AND q.organization_id = app_org_id()));
ALTER TABLE invoice_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON invoice_items
  USING (EXISTS (SELECT 1 FROM invoices i WHERE i.id = invoice_id AND i.organization_id = app_org_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM invoices i WHERE i.id = invoice_id AND i.organization_id = app_org_id()));
ALTER TABLE return_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON return_items
  USING (EXISTS (SELECT 1 FROM sales_returns r WHERE r.id = return_id AND r.organization_id = app_org_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM sales_returns r WHERE r.id = return_id AND r.organization_id = app_org_id()));

-- ───────── Privileges for the application role ─────────
-- Skipped when the role does not exist (e.g. a throwaway database); production creates it before migrating.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'velora_app') THEN
    GRANT USAGE ON SCHEMA public TO velora_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO velora_app;
    GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO velora_app;
    -- Append-only ledgers and history: no UPDATE, no DELETE.
    REVOKE UPDATE, DELETE ON stock_movements, payments, sales_returns, return_items, audit_logs FROM velora_app;
    -- Business records are never hard-deleted.
    REVOKE DELETE ON organizations, branches, products, customers, quotations, invoices, invoice_items,
      stock_levels, document_sequences, tax_rates, organization_members, users FROM velora_app;
    REVOKE ALL ON _prisma_migrations FROM velora_app;
  END IF;
END $$;
