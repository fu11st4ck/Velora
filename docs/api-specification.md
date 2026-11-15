# Velora — API Specification

Base URL `/api/v1`. Machine-readable contract: [`backend/openapi/openapi.yaml`](../backend/openapi/openapi.yaml). Errors: [`api-error-handling.md`](api-error-handling.md). Rules referenced as P#, T#, S#, D#, Y#, C# are in [`business-rules.md`](business-rules.md).

## 1. Conventions

| Topic | Standard |
|---|---|
| Format | JSON, UTF-8, `camelCase`. Unknown request fields are rejected (`400`). |
| Auth | `Authorization: Bearer <access token>` on everything except the public `/auth/*` routes and `/health/*`. |
| Tenant | Taken from the token. No organization id in URLs or bodies. Another tenant's ID returns `404`. |
| Roles | O = Owner, M = Manager, S = Sales. "M" includes O. "Own" = documents where the caller is the salesperson. |
| Money | Integer minor units, suffix `Minor`. Rates in basis points, suffix `Bp`. |
| Time | ISO 8601 UTC timestamps (`2026-11-15T10:14:00Z`); dates as `YYYY-MM-DD` in the organization timezone. |
| IDs | UUID. Create endpoints for customers, quotations, invoices and payments accept an optional client-generated `id` (offline creation). |
| Success envelope | `{ "data": … }`; lists add `"meta": { "nextCursor": "…" \| null, "hasMore": bool }`. |
| Pagination | Cursor: `limit` (1–100, default 25), `cursor`. |
| Sorting | `sort=field` or `sort=-field` from a per-endpoint whitelist. |
| Search | `q` — case-insensitive substring over documented fields. |
| Idempotency | `Idempotency-Key: <uuid>` is **required** on endpoints marked ⟳. Same key + same body → original response replayed (`Idempotent-Replayed: true`). Same key + different body → `409 IDEMPOTENCY_KEY_REUSED`. Keys are kept 7 days. |
| Concurrency | `PATCH` on products takes `version`; mismatch → `409 VERSION_CONFLICT`. |
| Field confidentiality | For role S the fields marked 🔒 are **omitted** from every response. |
| Rate limits | Per IP on auth routes, per user elsewhere; `429` with `Retry-After`. |

Status codes: `200` read/update · `201` created · `204` no content · `400` malformed · `401` unauthenticated · `403` forbidden · `404` not found · `409` conflict/state · `422` business validation · `429` rate limited · `5xx` server.

## 2. Endpoint inventory

| # | Method | Path | Purpose | Roles |
|---|---|---|---|---|
| 1 | POST | /auth/login | Sign in | public |
| 2 | POST | /auth/refresh | Rotate tokens | public (refresh token) |
| 3 | POST | /auth/logout | Revoke current session | any |
| 4 | POST | /auth/forgot-password | Request reset email | public |
| 5 | POST | /auth/reset-password | Set new password | public (reset token) |
| 6 | POST | /auth/change-password | Change own password | any |
| 7 | GET | /auth/me | Current user, role, organization settings | any |
| 8 | GET | /organization | Organization profile and settings | any (S: public subset) |
| 9 | PATCH | /organization | Update profile and settings | O |
| 10 | GET | /organization/members | List staff | M |
| 11 | POST | /organization/members | Invite staff | O |
| 12 | PATCH | /organization/members/{id} | Change role / deactivate | O |
| 13 | GET | /tax-rates | List tax rates | any |
| 14 | POST | /tax-rates | Create tax rate | O |
| 15 | PATCH | /tax-rates/{id} | Rename, set default, deactivate | O |
| 16 | GET | /products | List / search products | any |
| 17 | POST | /products ⟳ | Create product with opening stock | M |
| 18 | GET | /products/{id} | Product detail | any |
| 19 | PATCH | /products/{id} | Edit product | M |
| 20 | DELETE | /products/{id} | Archive product | M |
| 21 | POST | /products/{id}/image-upload-url | Presigned image upload | M |
| 22 | GET | /inventory/movements | Stock movement ledger | any (S: no cost) |
| 23 | POST | /inventory/receipts ⟳ | Receive stock | M |
| 24 | POST | /inventory/adjustments ⟳ | Adjust stock | M |
| 25 | GET | /customers | List / search customers | any |
| 26 | POST | /customers ⟳ | Create customer | any |
| 27 | GET | /customers/{id} | Customer detail with balances | any (S: own-document totals) |
| 28 | PATCH | /customers/{id} | Edit customer | any |
| 29 | DELETE | /customers/{id} | Archive customer | M |
| 30 | POST | /pricing/preview | Authoritative totals for a cart | any |
| 31 | GET | /documents | Combined quotations + invoices list | any (S: own) |
| 32 | POST | /quotations ⟳ | Create quotation | any |
| 33 | GET | /quotations/{id} | Quotation detail | any (S: own) |
| 34 | POST | /quotations/{id}/cancel | Cancel quotation | any (S: own) |
| 35 | GET | /quotations/{id}/pdf | Quotation PDF | any (S: own) |
| 36 | POST | /invoices ⟳ | Issue invoice (sale), optionally from a quotation, optionally with first payment | any |
| 37 | GET | /invoices/{id} | Invoice detail with payments and returns | any (S: own) |
| 38 | POST | /invoices/{id}/payments ⟳ | Record payment | any (S: own) |
| 39 | POST | /invoices/{id}/refunds ⟳ | Record refund (correction) | M |
| 40 | POST | /invoices/{id}/cancel ⟳ | Cancel invoice, restore stock | M |
| 41 | POST | /invoices/{id}/returns ⟳ | Return items (credit note) | M |
| 42 | GET | /invoices/{id}/pdf | Invoice PDF | any (S: own) |
| 43 | GET | /dashboard/summary | Home screen data | any (S: reduced) |
| 44 | GET | /reports/sales-summary | KPIs for a period | any (S: own, no cost) |
| 45 | GET | /reports/sales-by-salesperson | Sales per team member | M |
| 46 | GET | /reports/payment-status | Invoice status breakdown | any (S: own) |
| 47 | GET | /reports/inventory-valuation | Stock value at cost | M |
| 48 | GET | /sync/changes | Delta feed for offline cache | any |
| 49 | GET | /health/live, /health/ready | Probes | public |

Changes from the brief's starting list, with reasons:
- **No `/sales` resource** — a sale is an invoice (`POST /invoices`). Cancel and return live under `/invoices/{id}`.
- **`/documents`** added — the reference's combined "Quotations & invoices" list, served in one paginated query.
- **`/quotations`** added — exists in the reference.
- **`/dashboard/summary` only** — one round trip for the Home screen instead of four; recent activity and low stock are sections of it. Low-stock lists use `GET /products?stockStatus=low`.
- **`GET /inventory`, `/inventory/{productId}`, `/inventory/low-stock`** dropped — stock is part of the product resource.
- **`/reports/profit-loss`** not provided — there are no expenses, so a P&L would be misleading; gross profit is in `sales-summary`.
- **`/pricing/preview`, `/sync/changes`, `/tax-rates`, `/organization*`** added for server-authoritative totals, offline cache and configurable settings.

## 3. Endpoint details

For every endpoint: auth is Bearer unless "public"; authorization per the table above; generic errors (`400 VALIDATION_ERROR`, `401`, `403 FORBIDDEN`, `404 NOT_FOUND`, `429`) always apply and are not repeated.

### 3.1 Authentication

#### POST /auth/login — public
- **Body:** `{ "email": string, "password": string, "deviceName"?: string }`
- **Validation:** email format; password 1–200 chars.
- **200:**
```json
{ "data": {
  "accessToken": "eyJ…", "accessTokenExpiresAt": "2026-11-15T10:29:00Z",
  "refreshToken": "vr_5d0c…", "refreshTokenExpiresAt": "2026-12-15T10:14:00Z",
  "user": { "id": "0193…", "fullName": "Ahmed Khan", "email": "ahmed@velora.example" },
  "membership": { "memberId": "0193…", "role": "SALES", "branchId": null,
    "organization": { "id": "0193…", "name": "Velora Fine Jewellery LLC" } } } }
```
- **Errors:** `401 INVALID_CREDENTIALS` (same response for unknown email and wrong password); `403 ACCOUNT_DISABLED`; `429 TOO_MANY_ATTEMPTS`.
- **DB:** read user + membership; insert `refresh_tokens`; update `last_login_at`; audit `auth.login` / `auth.login_failed`. Single transaction.

#### POST /auth/refresh — public
- **Body:** `{ "refreshToken": string }` → **200** same token fields as login.
- **Errors:** `401 SESSION_REVOKED` (unknown, expired, revoked or already-rotated token; reuse revokes the whole family).
- **DB / Tx:** lock token row; mark `rotated_at`; insert successor in the same family. One transaction.

#### POST /auth/logout
- **Body:** `{ "refreshToken": string }` → **204**. Revokes the token family. Idempotent.

#### POST /auth/forgot-password — public
- **Body:** `{ "email": string }` → always **202** `{ "data": { "accepted": true } }`. Inserts a reset token (60 min) and sends email if the account exists.

#### POST /auth/reset-password — public
- **Body:** `{ "token": string, "newPassword": string }` → **204**.
- **Validation:** password ≥ 10 chars, not in the breached/common list.
- **Errors:** `422 RESET_TOKEN_INVALID`. **Tx:** set hash, mark token used, revoke all refresh tokens.

#### POST /auth/change-password
- **Body:** `{ "currentPassword", "newPassword" }` → **204**. Errors: `422 CURRENT_PASSWORD_INCORRECT`. Revokes other sessions.

#### GET /auth/me
- **200:** user, membership, permissions list, and the organization settings the app needs: `currencyCode, currencyExponent, timezone, locale, maxMarkupBp 🔒, defaultCreditDays, quotationValidityDays, lowStockThreshold, allowOfflineSales`, default tax rate.

### 3.2 Organization, members, tax rates

#### GET /organization · PATCH /organization (O)
- **PATCH body (all optional):** `name, legalName, taxRegistrationNumber, phone, email, addressLine, city, countryCode, invoiceFooter, lowStockThreshold (≥0), maxMarkupBp (0–100000), defaultMarkupBp, defaultMinMarkupBp, defaultCreditDays (0–365), quotationValidityDays (1–365), allowOfflineSales, currencyCode, timezone`.
- **Errors:** `409 SETTING_LOCKED` when changing currency or timezone after any document exists; `422` if `defaultMinMarkupBp > defaultMarkupBp > maxMarkupBp` ordering is violated or lowering `maxMarkupBp` below an existing product's default.
- **DB:** update + audit (before/after).

#### GET /organization/members (M) · POST (O) · PATCH /{id} (O)
- **POST body:** `{ "fullName", "email", "role": "MANAGER"|"SALES", "branchId"?: uuid }` → **201** member; sends an invitation email with a set-password link. Errors: `409 MEMBER_EXISTS`.
- **PATCH body:** `{ "role"?, "isActive"?, "branchId"? }`. Errors: `409 LAST_OWNER` (cannot demote or deactivate the only owner). Revokes the member's sessions. Audited.

#### GET /tax-rates · POST (O) · PATCH /{id} (O)
- **POST body:** `{ "name": string, "rateBp": 0–10000, "isDefault"?: bool }`. Errors: `409 DUPLICATE_NAME`.
- **PATCH body:** `{ "name"?, "isDefault"?, "isActive"? }` — `rateBp` is immutable (create a new rate instead, so history stays clear). Errors: `409 DEFAULT_RATE_REQUIRED` when deactivating the default.

### 3.3 Products

**Product representation**
```json
{ "id": "0193a4c0-…", "sku": "VLR-BR-001", "barcode": null,
  "name": "Alhambra Gold Bracelet",
  "description": "18K yellow gold bracelet with five clover motifs.",
  "weight": { "value": "12.800", "unit": "G" },
  "imageUrl": "https://…/signed", 
  "quantity": 24, "stockStatus": "IN_STOCK", "reorderLevel": null, "effectiveReorderLevel": 8,
  "listPriceMinor": 364000, "floorPriceMinor": 322000, "ceilingPriceMinor": 448000,
  "costMinor": 280000, "defaultMarkupBp": 3000, "minMarkupBp": 1500,
  "isActive": true, "archivedAt": null, "version": 3,
  "createdAt": "2026-08-01T08:00:00Z", "updatedAt": "2026-11-14T09:30:00Z" }
```
🔒 `costMinor`, `defaultMarkupBp`, `minMarkupBp`.

#### GET /products
- **Query:** `q` (name, SKU, barcode), `stockStatus` = `in_stock|low|out|attention` (low + out), `sellable=true` (active, quantity > 0), `includeArchived` (M), `sort` = `name|-name|quantity|-quantity|-createdAt` (default `name`), `limit`, `cursor`.
- **200:** list of products + `meta` (+ `meta.counts: { all, inStock, low, out }` on the first page).
- **DB:** `products` ⨝ `stock_levels` (caller's branch scope).

#### POST /products ⟳ (M)
- **Body:**
```json
{ "name": "Pearl Drop Ring", "sku": null, "barcode": "6291041500213",
  "description": "Freshwater pearl on 18K band.",
  "weight": { "value": "3.5", "unit": "G" },
  "costMinor": 100055, "defaultMarkupBp": 3000, "minMarkupBp": 1500,
  "openingQuantity": 2, "reorderLevel": 1,
  "supplierName": "Al Noor Gold Trading", "referenceNote": "PO 2231" }
```
- **Validation:** `name` 1–120; `sku` ≤ 40, `[A-Za-z0-9._-]`, generated `{PREFIX}-{6 digits}` when null; `costMinor` ≥ 0; rule P3; `openingQuantity` ≥ 0; `reorderLevel` ≥ 0; weight value > 0 with ≤ 3 decimals.
- **201:** product. **Errors:** `409 SKU_TAKEN`, `409 BARCODE_TAKEN`, `422 MARKUP_POLICY_INVALID`.
- **DB / Tx:** one transaction: insert product; insert `stock_levels`; if quantity > 0 insert `stock_movements` (`PURCHASE_RECEIPT`); audit.

#### GET /products/{id}
- **200:** product + `stockByBranch: [{ branchId, branchName, quantity }]`.

#### PATCH /products/{id} (M)
- **Body:** `version` (required) and any of `name, sku, barcode, description, weight, defaultMarkupBp, minMarkupBp, reorderLevel, imageKey, isActive`. `costMinor` and quantity are **not** editable here (receipts and adjustments only).
- **Errors:** `409 VERSION_CONFLICT`, `409 SKU_TAKEN`, `422 MARKUP_POLICY_INVALID`. **DB:** conditional update on `version`; audit with before/after.

#### DELETE /products/{id} (M)
- Archives. **204.** **Errors:** `409 PRODUCT_HAS_STOCK`. Idempotent.

#### POST /products/{id}/image-upload-url (M)
- **Body:** `{ "contentType": "image/jpeg"|"image/png"|"image/webp", "sizeBytes": ≤ 5242880 }`
- **200:** `{ "data": { "uploadUrl": "…", "imageKey": "org/…/products/….jpg", "expiresAt": "…" } }`. The client uploads, then `PATCH`es `imageKey`. The server verifies the object exists, its size and its real content type before accepting the key.

### 3.4 Inventory

#### GET /inventory/movements
- **Query:** `productId`, `type` (repeatable), `from`, `to`, `limit`, `cursor` (newest first).
- **200 item:** `{ id, productId, productName, productSku, type, quantityDelta, balanceAfter, unitCostMinor 🔒, invoice: { id, number } | null, return: { id, number } | null, supplierName 🔒, referenceNote, reason, createdBy: { memberId, fullName }, createdAt }`.

#### POST /inventory/receipts ⟳ (M)
- **Body:** `{ "productId": uuid, "quantity": int ≥ 1, "unitCostMinor": int ≥ 0, "supplierName"?: string ≤ 120, "referenceNote"?: string ≤ 240, "branchId"?: uuid }`
- **201:** `{ "data": { "movement": {…}, "product": {…} } }` (product shows new quantity and average cost).
- **Errors:** `422 PRODUCT_ARCHIVED`.
- **Tx:** lock stock level; insert movement; update quantity; recompute cost (S5); audit.

#### POST /inventory/adjustments ⟳ (M)
- **Body:** `{ "productId": uuid, "quantityDelta": int ≠ 0, "reason": string 3–240, "branchId"?: uuid }`
- **201:** movement + product. **Errors:** `409 INSUFFICIENT_STOCK` (with `details[].available`).
- **Tx:** conditional stock update; insert movement (`ADJUSTMENT_IN/OUT` at current cost); audit.

### 3.5 Customers

**Representation:** `{ id, name, company, mobile, email, address, taxRegistrationNumber, notes, archivedAt, createdAt, updatedAt }`; detail adds `summary: { invoicedMinor, outstandingMinor, overdueMinor, invoiceCount, lastInvoiceAt }`.

#### GET /customers
- **Query:** `q` (name, company, mobile, email), `sort` = `name|-createdAt|-lastInvoiceAt`, `limit`, `cursor`.

#### POST /customers ⟳
- **Body:** `{ "id"?: uuid, "name"?: string, "company"?: string, "mobile"?: string, "email"?: string, "address"?: string, "taxRegistrationNumber"?: string, "notes"?: string }`
- **Validation:** at least one of `name`, `company` (non-blank); `mobile` parseable as a phone number (stored E.164); `email` format; lengths ≤ 160.
- **201:** customer + `meta.possibleDuplicates: [{ id, name, company, mobile }]` (same mobile) — informational, not an error.

#### GET /customers/{id} · PATCH /customers/{id} · DELETE /customers/{id} (M)
- PATCH: same fields as POST; editing never changes issued documents (D2). DELETE archives; **204**.

### 3.6 Pricing

#### POST /pricing/preview
Stateless calculation used by the cart; identical code path to document creation.
- **Body:**
```json
{ "lines": [ { "productId": "0193…01", "quantity": 1, "unitPriceMinor": 364000 },
             { "productId": "0193…04", "quantity": 2, "unitPriceMinor": 298900 } ],
  "discountMinor": 15000, "taxRateId": "0193…a1" }
```
- **200:**
```json
{ "data": {
  "lines": [ { "productId": "0193…01", "quantity": 1, "unitPriceMinor": 364000, "lineTotalMinor": 364000,
               "available": 24, "issues": [] },
             { "productId": "0193…04", "quantity": 2, "unitPriceMinor": 298900, "lineTotalMinor": 597800,
               "available": 17, "issues": [] } ],
  "subtotalMinor": 961800, "discountMinor": 15000,
  "tax": { "name": "VAT 5%", "rateBp": 500, "amountMinor": 47340 },
  "totalMinor": 994140, "valid": true } }
```
- Line `issues` use the error codes `INSUFFICIENT_STOCK`, `PRICE_BELOW_MINIMUM`, `PRICE_ABOVE_MAXIMUM`, `PRODUCT_UNAVAILABLE`, each with the relevant bound. Preview returns `200` with `valid: false` rather than failing, so the cart can show every problem at once. Document-level problems (`DISCOUNT_EXCEEDS_SUBTOTAL`) are `422`.
- **DB:** reads only.

### 3.7 Documents list

#### GET /documents
- **Query:** `type` = `invoice|quotation`; `status` = `paid|partial|unpaid|overdue|cancelled|quotation_open|quotation_converted|quotation_expired|quotation_cancelled` (repeatable); `q` (number, customer name, company, mobile); `customerId`; `salespersonId` (M); `from`, `to` (issue date); `sort` = `-issuedAt` (default) `|issuedAt|-totalMinor|dueDate`; `limit`, `cursor`.
- **200 item:**
```json
{ "type": "INVOICE", "id": "0193…", "number": "INV-2026-00126", "issuedAt": "2026-11-15T10:14:00Z",
  "customer": { "id": "0193…", "name": "Maya Farah", "company": "Maison Luxe", "mobile": "+971558204412" },
  "salesperson": { "memberId": "0193…", "fullName": "Ahmed Khan" },
  "lineCount": 1, "totalMinor": 781200,
  "status": "ISSUED", "paymentStatus": "UNPAID", "isOverdue": false,
  "balanceMinor": 781200, "dueDate": "2026-12-15", "syncState": "SYNCED" }
```
Quotations carry `quotationStatus` and `validUntil` instead of the payment fields.
- **DB:** `UNION ALL` of invoices and quotations with shared filters and a `(issued_at, id)` cursor.

### 3.8 Quotations

#### POST /quotations ⟳
- **Body:**
```json
{ "id": "0193…client", "customerId": "0193…c7",
  "lines": [ { "productId": "0193…04", "quantity": 1, "unitPriceMinor": 298900 } ],
  "discountMinor": 15000, "taxRateId": "0193…a1", "validUntil": "2026-11-29", "notes": null }
```
- **Validation:** 1–100 lines; quantity ≥ 1; rules P4/P5 (`belowMinimumReason` per line for M); T3; tax rate active; customer exists and not archived; `validUntil` ≥ today (default today + `quotationValidityDays`). Stock is **not** required (D4).
- **201:** full quotation (header, customer snapshot, lines, totals, `status: "OPEN"`, `number`).
- **Errors:** `422 PRICE_BELOW_MINIMUM | PRICE_ABOVE_MAXIMUM | DISCOUNT_EXCEEDS_SUBTOTAL | PRODUCT_UNAVAILABLE | TAX_RATE_INACTIVE`.
- **Tx:** lock sequence; insert quotation + items; audit.

#### GET /quotations/{id}
- **200:** quotation with lines (`unitCostMinor`, `markupBp` 🔒), `invoice: { id, number } | null`, derived `status` (EXPIRED when past `validUntil`).

#### POST /quotations/{id}/cancel
- **Body:** `{ "reason"?: string }` → **200** quotation. **Errors:** `409 INVALID_STATE` unless OPEN/EXPIRED.

#### GET /quotations/{id}/pdf
- **200** `application/pdf`. `ETag` supported; `304` when unchanged.

### 3.9 Invoices

#### POST /invoices ⟳
The sale. Creates the invoice, deducts stock, and optionally records the first payment — atomically.
- **Body:**
```json
{ "id": "0193…client", "customerId": "0193…c7", "quotationId": null,
  "lines": [ { "productId": "0193…03", "quantity": 1, "unitPriceMinor": 744000 } ],
  "discountMinor": 0, "taxRateId": "0193…a1", "notes": null,
  "payment": { "amountMinor": 300000, "method": "BANK_TRANSFER", "reference": "FT26319XK2" },
  "creditDays": 30, "dueDate": null,
  "offline": null }
```
- **Validation:** as quotations, plus rule S3 (stock per product across lines); `payment` optional, `0 < amountMinor ≤ total` (Y4), `reference` ≤ 80; when the resulting balance > 0 exactly one of `creditDays` (0–365, default from settings) or `dueDate` (≥ today) applies; when balance = 0 both are ignored. `quotationId` must be the caller's (or any, for M), status OPEN or EXPIRED; lines may differ from the quotation. `offline` = `{ "createdAt": timestamp, "deviceId": string }` for queued offline sales (accepted only when `allowOfflineSales`; `issuedAt` is then the client time, bounded to the last 7 days).
- **201:**
```json
{ "data": { "id": "0193…", "number": "INV-2026-00126", "status": "ISSUED",
  "issuedAt": "2026-11-15T10:14:00Z", "currencyCode": "AED",
  "customer": { "id": "0193…c7", "name": "Maya Farah", "company": "Maison Luxe",
                "mobile": "+971558204412", "email": null, "address": null, "taxRegistrationNumber": null },
  "salesperson": { "memberId": "0193…", "fullName": "Ahmed Khan" },
  "lines": [ { "lineNo": 1, "productId": "0193…03", "name": "Diamond Tennis Bracelet", "sku": "VLR-DB-008",
               "quantity": 1, "returnedQuantity": 0, "unitPriceMinor": 744000, "lineTotalMinor": 744000,
               "unitCostMinor": 620000, "markupBp": 2000 } ],
  "subtotalMinor": 744000, "discountMinor": 0,
  "tax": { "name": "VAT 5%", "rateBp": 500, "amountMinor": 37200 },
  "totalMinor": 781200, "returnedMinor": 0, "paidMinor": 300000, "balanceMinor": 481200,
  "paymentStatus": "PARTIAL", "isOverdue": false, "creditDays": 30, "dueDate": "2026-12-15",
  "payments": [ { "id": "0193…", "kind": "PAYMENT", "method": "BANK_TRANSFER", "amountMinor": 300000,
                  "reference": "FT26319XK2", "receivedAt": "2026-11-15T10:14:00Z",
                  "recordedBy": { "memberId": "0193…", "fullName": "Ahmed Khan" } } ],
  "returns": [], "quotation": null,
  "profit": { "costMinor": 620000, "grossProfitMinor": 124000, "marginBp": 1667 } } }
```
🔒 `lines[].unitCostMinor`, `lines[].markupBp`, `profit`.
- **Errors:** `409 INSUFFICIENT_STOCK` (`details: [{ lineNo, productId, requested, available }]`); `409 QUOTATION_ALREADY_CONVERTED`; `422 PRICE_BELOW_MINIMUM | PRICE_ABOVE_MAXIMUM | DISCOUNT_EXCEEDS_SUBTOTAL | PAYMENT_EXCEEDS_BALANCE | PRODUCT_UNAVAILABLE | TAX_RATE_INACTIVE | OFFLINE_SALES_DISABLED`.
- **Tx:** the sequence in [`system-architecture.md`](system-architecture.md) §4.3 — conditional stock updates, number allocation, inserts (invoice, items, `SALE` movements, payment), quotation → CONVERTED, audit, idempotency record. All or nothing.

#### GET /invoices/{id}
- **200:** the representation above, plus `cancellation: { at, by, reason } | null` and `returns: [{ id, number, totalMinor, createdAt, lines: [{ lineNo, quantity, restock }] }]`.

#### POST /invoices/{id}/payments ⟳
- **Body:** `{ "id"?: uuid, "amountMinor": int, "method": "CASH"|"BANK_TRANSFER", "reference"?: string, "receivedAt"?: timestamp, "note"?: string }`
- **Validation:** `0 < amountMinor ≤ balanceMinor`; `receivedAt` not in the future and not before `issuedAt`.
- **201:** `{ "data": { "payment": {…}, "invoice": { …updated summary… } } }`
- **Errors:** `409 INVOICE_CANCELLED`; `422 PAYMENT_EXCEEDS_BALANCE` (`details.balanceMinor`); `422 INVOICE_ALREADY_PAID`.
- **Tx:** `SELECT invoice FOR UPDATE`; insert payment; update `paid_minor`, `payment_status`; audit.

#### POST /invoices/{id}/refunds ⟳ (M)
- **Body:** `{ "amountMinor", "method", "reference"?, "note": string (required) }` — corrects a mis-recorded payment. `amountMinor ≤ paidMinor`. **Errors:** `422 REFUND_EXCEEDS_PAID`.

#### POST /invoices/{id}/cancel ⟳ (M)
- **Body:** `{ "reason": string 3–240, "refundMethod"?: "CASH"|"BANK_TRANSFER", "refundReference"?: string }` — `refundMethod` required when `paidMinor > 0`.
- **200:** invoice with `status: "CANCELLED"`.
- **Errors:** `409 INVOICE_CANCELLED`; `409 INVOICE_HAS_RETURNS`; `422 REFUND_METHOD_REQUIRED`.
- **Tx:** lock invoice; insert `REFUND` for `paidMinor`; insert `SALE_CANCELLATION` movements and restore stock (S7); set status, `cancelled_*`; audit.

#### POST /invoices/{id}/returns ⟳ (M)
- **Body:**
```json
{ "reason": "Customer changed mind",
  "lines": [ { "lineNo": 1, "quantity": 1, "restock": true } ],
  "refund": { "method": "CASH", "reference": null } }
```
- **Validation:** each `quantity` ≥ 1 and ≤ `quantity − returnedQuantity`; rule C4 — `refund` required exactly when the credit exceeds the balance (the refund amount is computed by the server).
- **201:** `{ "data": { "return": { "id", "number": "CN-2026-00003", "subtotalMinor", "taxMinor", "totalMinor", "refundMinor", "lines": […] }, "invoice": {…} } }`
- **Errors:** `409 INVOICE_CANCELLED`; `422 RETURN_QUANTITY_EXCEEDS_SOLD`; `422 REFUND_METHOD_REQUIRED`.
- **Tx:** lock invoice; allocate credit-note number; insert return + items; `CUSTOMER_RETURN` movements for restocked lines; update `returned_quantity`, `returned_minor`; insert `REFUND` if due; recompute status; audit.

#### GET /invoices/{id}/pdf
- **200** `application/pdf` (customer-facing: no cost, markup or profit; shows seller and customer TRN, payments and balance). Regenerated after payments/returns; `ETag` reflects the invoice's `updatedAt`.

### 3.10 Dashboard and reports

#### GET /dashboard/summary
- **200:**
```json
{ "data": {
  "asOf": "2026-11-15T10:20:00Z", "currencyCode": "AED",
  "todaySales": { "invoicedMinor": 845000, "invoiceCount": 3, "yesterdayInvoicedMinor": 751800, "changeBp": 1240 },
  "stock": { "units": 53, "productCount": 4, "lowCount": 2, "outCount": 0 },
  "outstanding": { "balanceMinor": 1250000, "invoiceCount": 3, "overdueMinor": 0, "overdueCount": 0 },
  "monthProfit": { "netSalesMinor": 7530000, "grossProfitMinor": 1845000, "marginBp": 2450 },
  "inventoryValueMinor": 15085000,
  "attentionProducts": [ { "id": "…", "name": "Classic Gold Bangle", "quantity": 8, "stockStatus": "LOW" } ],
  "recentDocuments": [ { "…": "same shape as GET /documents items, max 5" } ] } }
```
🔒 `monthProfit`, `inventoryValueMinor`. For S, sales and outstanding figures cover own documents. `changeBp` is null when yesterday is zero.
- **DB:** aggregate queries on indexed columns; no caching in v1 (measured first).

#### GET /reports/sales-summary
- **Query:** `from`, `to` (dates, required, ≤ 366 days), `salespersonId` (M).
- **200:** `{ invoiceCount, invoicedMinor, netSalesMinor, taxMinor, discountMinor, returnsMinor, cogsMinor 🔒, grossProfitMinor 🔒, marginBp 🔒, receivedMinor, outstandingNowMinor, overdueNowMinor }` (definitions: business rules §8).
- `Accept: text/csv` returns one row per invoice in the period (M only).

#### GET /reports/sales-by-salesperson (M)
- **Query:** `from`, `to`. **200:** `[{ memberId, fullName, invoiceCount, invoicedMinor, netSalesMinor, grossProfitMinor }]` sorted by `netSalesMinor` desc.

#### GET /reports/payment-status
- **Query:** `from`, `to`. **200:** `[{ status: "PAID"|"PARTIAL"|"UNPAID"|"OVERDUE", count, totalMinor, balanceMinor }]` (OVERDUE is a subset shown separately; shares are computed by the client from counts of PAID/PARTIAL/UNPAID).

#### GET /reports/inventory-valuation (M)
- **Query:** `limit`, `cursor`, `sort` = `-valueMinor|name`. **200:** `summary: { units, valueMinor, productCount }` in `meta`, items `[{ productId, name, sku, quantity, costMinor, valueMinor }]`. `Accept: text/csv` supported.

### 3.11 Sync

#### GET /sync/changes
- **Query:** `since` (opaque token from the previous call; omit for a full snapshot), `entities` = `products,customers` (default both), `limit` (≤ 500).
- **200:** `{ "data": { "products": { "upserted": [...], "archivedIds": [...] }, "customers": { "upserted": [...], "archivedIds": [...] } }, "meta": { "next": "token", "hasMore": false, "serverTime": "…" } }`
- Products obey the same role field policy. **DB:** range scan on `(organization_id, updated_at)`; the token encodes `(updated_at, id)` with a small overlap window, so no change is missed under concurrent commits.

### 3.12 Health
`GET /health/live` → 200 if the process is up. `GET /health/ready` → 200 if the database answers and migrations are current; 503 otherwise.
