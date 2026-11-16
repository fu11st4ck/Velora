# Velora — Database Design

PostgreSQL 16. Source of truth: [`backend/prisma/schema.prisma`](../backend/prisma/schema.prisma) (validated with `prisma validate`). Diagram: [`entity-relationship-diagram.md`](entity-relationship-diagram.md). Rules implemented: [`business-rules.md`](business-rules.md).

## 1. Design principles

1. **Tenant ownership.** Every business table has `organization_id NOT NULL`. Child rows that are only ever reached through a parent (`quotation_items`, `invoice_items`, `return_items`) inherit ownership from the parent.
2. **History is append-only.** `stock_movements`, `payments`, `sales_returns`, `return_items`, `audit_logs` are insert-only. Issued `invoices` and `invoice_items` are immutable except for the derived cache columns listed in §4. Database privileges for the application role exclude `UPDATE`/`DELETE` on the insert-only tables.
3. **Money as `BIGINT` minor units; rates as `INTEGER` basis points.** No `float`, no `numeric` for money. Weight is `NUMERIC(12,3)` (a measurement, not money).
4. **Snapshots on documents.** Customer and product details and costs are copied onto documents.
5. **No hard deletes of business data.** Products and customers are archived (`archived_at`). All foreign keys are `ON DELETE RESTRICT` except tokens and line items of a never-issued parent.
6. **UUIDv7 keys.** Time-ordered (index-friendly) and safe to generate on a device for offline creation.
7. **Only tables the product needs.** See §6 for candidates deliberately left out.

## 2. Tables

Types are PostgreSQL types. PK = primary key. All `id` columns are `uuid` PK. All `created_at`/`updated_at` are `timestamptz NOT NULL DEFAULT now()`.

### organizations
| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| name | text | no | | Trading name |
| legal_name, tax_registration_number, phone, email, address_line, city | text | yes | | Printed on documents |
| country_code | char(2) | yes | | ISO 3166-1 |
| logo_key | text | yes | | Object-storage key |
| currency_code | char(3) | no | | ISO 4217; locked after first document |
| currency_exponent | smallint | no | 2 | Minor-unit digits |
| timezone | text | no | | IANA; locked after first document |
| locale | text | no | 'en' | |
| low_stock_threshold | int | no | 8 | Reference value |
| max_markup_bp | int | no | 6000 | Reference value (60%) |
| default_markup_bp / default_min_markup_bp | int | no | 3000 / 1500 | Form defaults (reference values) |
| default_credit_days | int | no | 30 | Reference value |
| quotation_validity_days | int | no | 14 | |
| allow_offline_sales | boolean | no | false | |
| invoice_footer | text | yes | | |

Business settings are columns here, not a separate `business_settings` table: the relationship is strictly 1:1 and always read together.

### branches
`organization_id` FK → organizations · `name` text · `code` text · `is_default` bool · `is_active` bool.
Unique `(organization_id, code)`. Partial unique index on `(organization_id) WHERE is_default` (SQL migration). One default branch is created with the organization; v1 UI is single-branch.

### users
`email` citext **unique** · `password_hash` text (Argon2id) · `full_name` text · `phone` text null · `is_active` bool default true · `failed_login_count` int default 0 · `locked_until` timestamptz null (account lockout) · `last_login_at` timestamptz null.
Users are global identities; access to a tenant comes only from `organization_members`.

### organization_members
`organization_id` FK · `user_id` FK · `role` enum `OWNER|MANAGER|SALES` · `branch_id` FK null (null = all branches) · `is_active` bool.
Unique `(organization_id, user_id)`. Index `(user_id)`. This row — not the user — is the actor on documents, payments and movements.

Roles are an enum with a permission map in code. `roles`, `permissions` and `user_roles` tables are not created: three fixed roles do not justify runtime-configurable RBAC (ADR-0005).

### refresh_tokens
`user_id` FK cascade · `member_id` FK cascade (the membership the session acts as) · `family_id` uuid · `token_hash` text **unique** · `device_name` text null · `ip_address` inet null · `expires_at` · `rotated_at` null · `revoked_at` null · `revoke_reason` text null.
Indexes `(user_id)`, `(family_id)`. A token family is the session; no separate `sessions` table.

### password_reset_tokens
`user_id` FK cascade · `token_hash` text **unique** · `expires_at` · `used_at` null.

### tax_rates
`organization_id` FK · `name` text · `rate_bp` int (`CHECK 0..10000`) · `is_default` bool · `is_active` bool.
Unique `(organization_id, name)`; partial unique `(organization_id) WHERE is_default`. Seeded for the demo organization with "VAT 5%" (default) and "Zero rated 0%" — the reference's two options.

### products
| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| organization_id | uuid FK | no | | |
| sku | text | no | | Unique per org, case-insensitive (`UNIQUE (organization_id, lower(sku))` in SQL) |
| barcode | text | yes | | Partial unique per org when not null |
| name | text | no | | |
| description | text | yes | | Reference required it; optional here |
| weight_value | numeric(12,3) | yes | | |
| weight_unit | enum `G|KG` | yes | | Both null or both set (`CHECK`) |
| image_key | text | yes | | |
| cost_minor | bigint | no | | Moving weighted average; `CHECK >= 0` |
| default_markup_bp | int | no | | |
| min_markup_bp | int | no | | `CHECK 0 <= min <= default` |
| reorder_level | int | yes | | Null = org threshold |
| is_active | bool | no | true | |
| archived_at | timestamptz | yes | | Soft delete |
| version | int | no | 1 | Optimistic lock |

Indexes: `(organization_id, name)`, `(organization_id, barcode)`, `(organization_id, updated_at)` for delta sync; trigram GIN on `name` and `sku` for substring search (SQL migration, `pg_trgm`).

Not created: `product_variants`, `product_categories`, `product_images`, `units_of_measure` — the reference has one photo, no variants, no categories, and sells in pieces.

### stock_levels
`organization_id` FK · `product_id` FK · `branch_id` FK · `quantity` int default 0 (`CHECK quantity >= 0`).
Unique `(product_id, branch_id)`. Index `(organization_id, branch_id, quantity)` for low-stock queries. A transactional cache of the movement ledger.

### stock_movements  *(append-only)*
| Column | Type | Null | Notes |
|---|---|---|---|
| organization_id, product_id, branch_id | uuid FK | no | |
| type | enum | no | `OPENING, PURCHASE_RECEIPT, SALE, SALE_CANCELLATION, CUSTOMER_RETURN, ADJUSTMENT_IN, ADJUSTMENT_OUT` |
| quantity_delta | int | no | Signed; `CHECK <> 0`; sign must match type (`CHECK`) |
| balance_after | int | no | `CHECK >= 0` |
| unit_cost_minor | bigint | no | Cost attached to the movement |
| invoice_id | uuid FK | yes | Set for SALE / SALE_CANCELLATION |
| return_id | uuid FK | yes | Set for CUSTOMER_RETURN |
| supplier_name, reference_note | text | yes | Receipts |
| reason | text | yes | Required for adjustments (`CHECK`) |
| created_by_id | uuid FK → organization_members | no | |

Indexes: `(organization_id, product_id, created_at)`, `(organization_id, created_at)`, `(invoice_id)`, `(return_id)`.
One ledger replaces the candidate tables `inventory`, `stock_adjustments`, `inventory_transactions`, `purchases` and `purchase_items`. `stock_transfers` is not created (single branch in v1; a transfer would later be two linked movements).

### customers
`organization_id` FK · `name`, `company`, `mobile`, `email`, `address`, `tax_registration_number`, `notes` text null · `archived_at` null.
`CHECK (name IS NOT NULL OR company IS NOT NULL)` — the reference's rule. Indexes `(organization_id, mobile)`, `(organization_id, name)`, `(organization_id, company)`, `(organization_id, updated_at)`. Mobile is not unique (families and companies share numbers); the API warns on duplicates.

### document_sequences
`organization_id` FK · `type` enum `QUOTATION|INVOICE|CREDIT_NOTE` · `year` smallint · `prefix` text · `last_number` int default 0. Unique `(organization_id, type, year)`.

### quotations / quotation_items
Header: organization, branch, `number` (unique per org), `status` enum `OPEN|CONVERTED|EXPIRED|CANCELLED`, `customer_id` FK + six snapshot columns, `salesperson_id` FK → organization_members, `currency_code`, `subtotal_minor`, `discount_minor`, `tax_rate_id` FK null, `tax_name`, `tax_rate_bp`, `tax_minor`, `total_minor`, `valid_until` date null, `notes`, `issued_at`, `cancelled_at`.
Indexes: `(organization_id, issued_at)`, `(organization_id, salesperson_id, issued_at)`, `(organization_id, customer_id)`, `(organization_id, status)`.
Items: `quotation_id` FK cascade, `line_no` smallint (unique with quotation), `product_id` FK, `product_name`, `product_sku`, `quantity` int (`CHECK > 0`), `unit_cost_minor`, `markup_bp`, `unit_price_minor`, `line_total_minor`.

### invoices
| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| organization_id, branch_id | uuid FK | no | | |
| number | text | no | | Unique `(organization_id, number)` |
| status | enum `ISSUED|CANCELLED` | no | ISSUED | |
| quotation_id | uuid FK **unique** | yes | | One invoice per quotation |
| customer_id | uuid FK | no | | + snapshot columns `customer_*` |
| salesperson_id | uuid FK → organization_members | no | | |
| currency_code | char(3) | no | | Snapshot |
| subtotal_minor, discount_minor, tax_minor, total_minor | bigint | no | | Immutable; `CHECK` 0 ≤ discount ≤ subtotal; total = subtotal − discount + tax |
| tax_rate_id / tax_name / tax_rate_bp | uuid FK null / text / int | | | Snapshot |
| cost_minor | bigint | no | | Σ line cost; manager-only |
| paid_minor | bigint | no | 0 | **Derived cache** |
| returned_minor | bigint | no | 0 | **Derived cache** |
| payment_status | enum `UNPAID|PARTIAL|PAID` | no | UNPAID | **Derived cache** |
| credit_days | int | yes | | |
| due_date | date | yes | | Required when balance > 0 at issue |
| notes | text | yes | | |
| issued_at | timestamptz | no | now() | |
| cancelled_at, cancelled_by_id, cancel_reason | | yes | | Set once |

`CHECK (paid_minor >= 0 AND returned_minor >= 0 AND paid_minor + returned_minor <= total_minor)`.
Indexes: `(organization_id, issued_at)`, `(organization_id, salesperson_id, issued_at)`, `(organization_id, customer_id)`, `(organization_id, status, payment_status)`, `(organization_id, due_date)`.

A separate `sales` table is not created: in this product a sale *is* an invoice. `invoice_items` therefore also serves as `sale_items`.

### invoice_items
As quotation items plus `discount_alloc_minor`, `tax_minor` (allocations, immutable) and `returned_quantity` (**derived cache**, `CHECK 0 <= returned_quantity <= quantity`). FK to invoice is `RESTRICT`.

### payments  *(append-only)*
`organization_id` FK · `invoice_id` FK · `kind` enum `PAYMENT|REFUND` · `method` enum `CASH|BANK_TRANSFER` · `amount_minor` bigint (`CHECK > 0`) · `reference`, `note` text null · `return_id` FK null · `received_at` timestamptz · `recorded_by_id` FK → organization_members.
Indexes `(organization_id, received_at)`, `(invoice_id)`.
`payment_allocations` is not created: a payment settles exactly one invoice in v1 (rule Y7).

### sales_returns / return_items  *(append-only)*
Return: organization, `invoice_id` FK, `number` (unique per org), `reason`, `subtotal_minor`, `tax_minor`, `total_minor`, `created_by_id`.
Item: `return_id` FK, `invoice_item_id` FK (unique with return), `quantity` (`CHECK > 0`), `amount_minor`, `tax_minor`, `restock` bool.

### idempotency_keys
`organization_id` FK cascade · `key` text · `user_id` · `method`, `path` · `request_hash` · `response_status` int null · `response_body` jsonb null · `expires_at`. Unique `(organization_id, key)`; index `(expires_at)` for the cleanup job (retain 7 days — longer than the maximum offline replay window the app allows).

### audit_logs  *(append-only)*
`organization_id` FK **null** (null only for pre-tenant authentication events such as a failed sign-in for an unknown account) · `actor_user_id` uuid null · `action` text · `entity_type` text null · `entity_id` uuid null · `before`, `after` jsonb null · `ip_address` inet null · `user_agent`, `request_id` text null.
Indexes `(organization_id, created_at)`, `(organization_id, entity_type, entity_id)`. No foreign keys on actor/entity so entries can never block or be removed by other changes.

## 3. Multi-tenant isolation

1. **Application:** a request-scoped tenant context supplies `organization_id` to every repository call; repositories have no method that omits it.
2. **Database:** row-level security on every tenant table: `USING (organization_id = current_setting('app.organization_id')::uuid)`. The transaction helper runs `SET LOCAL app.organization_id = …` first. The application connects as a role without `BYPASSRLS`; migrations use a separate owner role.
3. **Tests:** an integration suite creates two organizations and asserts every endpoint returns 404 for the other tenant's IDs, plus a direct-SQL test that RLS blocks cross-tenant reads.

Cross-tenant references are also prevented structurally: service code loads referenced rows (customer, product, tax rate, branch) through the tenant-scoped repository before using them.

## 4. Derived columns and their invariants

| Column | Equals | Maintained by |
|---|---|---|
| `stock_levels.quantity` | Σ `stock_movements.quantity_delta` for product+branch | Same transaction as each movement |
| `products.cost_minor` | Weighted average per rule S5 | Receipt / return / cancellation transactions |
| `invoices.paid_minor` | Σ PAYMENT − Σ REFUND | Payment transactions |
| `invoices.returned_minor` | Σ `sales_returns.total_minor` | Return transaction |
| `invoices.payment_status` | Rule Y3 | Payment / return transactions |
| `invoice_items.returned_quantity` | Σ `return_items.quantity` | Return transaction |

A nightly consistency job recomputes each from its ledger and raises an alert on any difference; it does not auto-correct.

## 5. Constraints added by SQL migration

Prisma cannot declare these; they are in the first migration and covered by tests: all `CHECK` constraints above; case-insensitive and partial unique indexes; `citext` and `pg_trgm` extensions; row-level security policies; `REVOKE UPDATE, DELETE` on insert-only tables from the application role.

## 6. Candidate entities deliberately not created

| Candidate | Decision |
|---|---|
| roles, permissions, user_roles | Enum + code map (ADR-0005) |
| sessions | `refresh_tokens.family_id` |
| business_settings | Columns on `organizations` |
| product_categories, product_variants, product_images, units_of_measure | Not in the reference; add when a requirement appears |
| inventory, stock_adjustments, inventory_transactions | Covered by `stock_levels` + `stock_movements` |
| stock_transfers | Multi-branch is not in scope |
| suppliers, purchases, purchase_items | Receipts carry an optional supplier name (decision D6) |
| sales, sale_items | Merged into invoices |
| payment_allocations | One payment → one invoice |
| expenses, expense_categories, notifications | No evidence in the reference; deferred |

## 7. Migration and seed policy

- Forward-only migrations in `backend/prisma/migrations`, applied by `prisma migrate deploy`.
- `seed.ts` creates the demo organization from the reference data (Velora Fine Jewellery LLC, AED, Asia/Dubai, 4 products, 2 users) **only** when `SEED_DEMO=true`; never in production.
