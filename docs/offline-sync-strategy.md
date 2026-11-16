# Velora — Offline and Synchronization Strategy

## 1. Position

The reference "works offline" only because it has no server: one browser, one user, no shared truth. A multi-user shop cannot work that way — two phones selling the last bracelet must not both succeed. The strategy is therefore **server-authoritative with an offline-tolerant client**:

- Reading and preparing work offline, always.
- Writes that cannot create inconsistency are queued.
- Writes that change stock or money are confirmed by the server before they count; where the business explicitly opts in to offline invoicing, the result is marked provisional until confirmed.
- **Nothing is ever resolved silently.** A rejected operation is shown to the user with the reason and stays in the queue until they fix or discard it.

## 2. Operation matrix

| Operation | Offline behaviour | Why |
|---|---|---|
| Browse products, customers | ✅ From cache, with "as of" time | Read-only |
| Browse documents | ✅ Recently viewed/listed documents from cache | Read-only |
| Dashboard, reports | ⚠️ Last loaded figures, clearly timestamped | Aggregates cannot be computed locally with confidence |
| Build cart, save draft | ✅ Local only | No shared effect |
| Create customer | ✅ Queued (client UUID) | No conflict possible beyond duplicates, which are surfaced |
| Edit customer | ❌ Online | Avoids overwrite conflicts for little benefit |
| Create quotation | ✅ Queued; shown without a number until synced | No stock or money effect; price bounds re-checked on sync |
| Record payment on an existing invoice | ✅ Queued | Idempotent; server rejects if it would exceed the balance |
| **Issue invoice** | ⚙️ Off by default. With `allowOfflineSales`: queued as **provisional** | Stock and numbering need the server |
| Create/edit product, receive stock, adjust stock | ❌ Online | Stock ledger and cost averaging must be serialized |
| Cancel invoice, returns, refunds | ❌ Online | Money and stock reversal |
| Settings, team | ❌ Online | |

## 3. Local storage (Drift / SQLite)

| Table | Content |
|---|---|
| `cached_products`, `cached_customers` | Mirror of server rows (role-filtered as received) + `synced_at` |
| `cached_documents` | Summaries and details of documents the user has opened or listed (LRU, capped) |
| `sync_state` | Delta token per entity, last successful sync time |
| `drafts` | Carts in progress (lines, customer, adjustments) |
| `outbox` | Pending operations: `id`, `type`, `idempotency_key`, `payload` JSON, `created_at`, `state` (`pending`, `sending`, `failed_retryable`, `needs_attention`), `attempts`, `last_error_code`, `last_error_details`, `depends_on` |
| `pending_entities` | Locally created customers / quotations / provisional invoices, replaced by server versions on success |

The database file lives in the app's private storage and is excluded from cloud/device backups. It is wiped on sign-out **after** the user confirms what will happen to unsynced items, and on account switch. Sales-role caches contain no cost data because the server never sends it.

## 4. Sync engine

### 4.1 Download (delta)
- Triggers: app start, return to foreground, connectivity regained, pull-to-refresh, every 5 minutes while in the foreground, and after any successful upload.
- `GET /sync/changes?since=<token>` pages until `hasMore = false`; upserts and archive IDs are applied in one local transaction per page; the token is saved with the page.
- A missing or rejected token triggers a full snapshot.

### 4.2 Upload (outbox)
- Strict FIFO per device. An operation with `depends_on` (a quotation or invoice referencing a customer created offline) waits for its dependency; IDs are client-generated UUIDs, so no ID rewriting is needed.
- Each operation is sent with its stored `Idempotency-Key` — the same key on every attempt.
- Outcome handling:

| Server result | Action |
|---|---|
| 2xx | Replace the pending entity with the server entity (number assigned); delete from outbox |
| 2xx replay (`Idempotent-Replayed`) | Same — the earlier attempt had succeeded |
| Network error, timeout, 5xx, 429 | `failed_retryable`; backoff 2 s → 5 min with jitter; retried indefinitely while the item is younger than 7 days |
| 401 | Pause the queue; refresh or re-login; resume |
| 403 | `needs_attention` ("You no longer have permission") |
| 409 / 422 | `needs_attention` with code and details; **dependants are held, later independent operations continue** |
| 404 on a referenced entity | `needs_attention` |
| `REQUEST_IN_PROGRESS` | Short retry with the same key |

- After 7 days unsynced an item becomes `needs_attention` (idempotency keys are retained 7 days server-side; replaying beyond that could duplicate).

### 4.3 Needs attention
Shown in a persistent banner and in More → Sync queue. For each item the user can:
- **Edit and resubmit** — opens the cart or form with the stored content and the server's findings (e.g. "Only 2 available"); resubmission uses a **new** idempotency key.
- **Discard** — with confirmation. For a provisional invoice the dialog states plainly that the customer was given a receipt that will not exist.

## 5. Provisional invoices (only when `allowOfflineSales` is on)

1. Offline, the app validates against cached data (price bounds, cached stock) and stores the invoice as **Provisional**: no number, labelled "Provisional — pending confirmation" on screen and on the shareable receipt; local cached stock is decremented and marked as an estimate.
2. On sync the server runs the normal `POST /invoices` transaction with `offline.createdAt` as the issue time (accepted within 7 days). The number is assigned at sync time, so numbering stays gapless and ordered by confirmation.
3. If stock is insufficient the server **rejects** — it does not partially fulfil, back-order or go negative. The item becomes Needs attention; a manager decides: reduce the quantity, receive/adjust stock first then retry, or discard.
4. Managers see a "Provisional sales awaiting sync" count on their dashboard only once those items reach the server as rejections; unsynced items on other devices are invisible to the server by nature — the main reason this mode is opt-in.

**Residual risk, stated plainly:** with offline invoicing on, a customer can walk out with an item and a provisional receipt for a sale the server later rejects (e.g. another device sold the same piece). The system guarantees this is *detected and surfaced*, not that it cannot happen. For one-of-a-kind jewellery we recommend keeping the setting off and using drafts and quotations offline.

## 6. Conflict and failure scenarios

| Scenario | Handling |
|---|---|
| Same request sent twice (retry, double tap, app killed mid-request) | Idempotency key → single effect |
| Two devices sell the last unit while online | Conditional stock update; second gets `INSUFFICIENT_STOCK`; cart preserved |
| Price policy changed while a quotation waited offline | Server re-validates → `PRICE_BELOW_MINIMUM` → Needs attention |
| Product archived while in an offline cart | `PRODUCT_UNAVAILABLE` → Needs attention |
| Offline payment exceeds the balance because someone else recorded one | `PAYMENT_EXCEEDS_BALANCE` with current balance → user corrects amount |
| Offline payment on an invoice cancelled meanwhile | `INVOICE_CANCELLED` → Needs attention (manager records the money handling) |
| Access token expires offline | App keeps working on cache and outbox; refresh on reconnect |
| Refresh token expired or revoked while offline | Queue pauses; login required; outbox and drafts are kept and resume after login **as the same user**. A different user signing in must first resolve or discard the previous user's queue (manager override) |
| User deactivated while offline | Sync returns `ACCOUNT_DISABLED`; queue is frozen and visible to a manager on that device after login |
| Device clock wrong | Server time is authoritative for all records; `offline.createdAt` outside the 7-day window is rejected with a clear error |
| App reinstalled / storage cleared with a non-empty outbox | Unsynced work is lost — sign-out and "clear data" flows warn explicitly; provisional receipts carry a device reference so a manager can re-enter them |
| Partial sync (some items succeed) | Each operation is independent and atomic; the queue reflects exactly what remains |
| Local database migration fails after an app update | Caches are rebuildable and are dropped; `outbox`, `drafts`, `pending_entities` are migrated with tested migrations and backed up to a JSON file before migrating |

## 7. User-visible states

- **Offline banner** with last sync time.
- **Sync badge** on More and a status icon on Home: synced / syncing / N waiting / N need attention.
- Pending documents are visually distinct (dashed outline, "Waiting to sync") and cannot be shared as final documents.
- Server-only actions are disabled offline and explain why when tapped.

## 8. Testing

Covered in [`testing-strategy.md`](testing-strategy.md): outbox ordering and dependency tests, idempotent replay against the real API, forced-conflict integration tests (two clients, one stock unit), kill-and-restart during send, token expiry mid-queue, and local migration tests with a populated outbox.

## 9. As built (Sprint 6)

What exists, and where it differs from the plan above.

**Built as described:** server-authoritative writes; the operation matrix for products, customers, quotations, payments and invoices; the queue with a stable idempotency key per item, strict order, dependants held behind a refused item, 7-day expiry, nothing resolved silently; copies erased on sign-out and on a change of person or role; offline banner with the age of the data; badge on More; Sync screen.

**Different:**
- **Storage** uses the `sqlite3` package directly (tables `cached_products`, `cached_customers`, `state`, `outbox`) rather than Drift — no code generation, and the same engine. There are no `cached_documents`, `drafts` or `pending_entities` tables: a customer created offline is a flagged row in `cached_customers`; a queued quotation exists only in the queue.
- **Documents, dashboard and reports are not available offline.** A payment can therefore only be queued when the connection drops while an invoice is open.
- **Connectivity** is inferred from the app's own requests (no network plugin): "offline" means the last request did not get through.
- **Triggers:** sign-in or start, return to the foreground, every 5 minutes while open, "Sync now", and immediately after something is queued. There is no per-item backoff timer; a waiting item is retried at the next trigger.
- **Needs attention** offers *Try again* (as a new request, with a new key) and *Discard*. "Edit and resubmit" is not built.
- **Offline totals** are computed on the device with the same integer rules and labelled as such on the cart; the server prices the quotation again when it is sent.
- **Other people's unsent items** stay on the device untouched and are sent when their owner signs in again; they do not block the next person.
- **Provisional (offline) invoices are not built.** An invoice always needs the server.
- **Start-up offline** works from the last loaded profile; a device that has never been online with this account shows the connection error instead of an empty shop.

**Not verified on a device:** the database file in app storage, behaviour when the operating system suspends the app mid-send, and backup exclusion.
