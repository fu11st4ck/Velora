# Tasks

Legend: `[x]` done · `[ ]` open · `[~]` in progress · **(blocked: …)**. Detailed backlog with dependencies: [`docs/implementation-roadmap.md`](docs/implementation-roadmap.md).

## Sprint 0 — Discovery and architecture
- [x] Inspect workspace, tooling and repository (empty repository; no Flutter SDK, Android SDK or Docker daemon)
- [x] Gain access to and audit the complete reference application (source + Playwright, 3 viewports, both roles)
- [x] `docs/product-discovery.md`, `docs/user-flow-map.md`, `docs/feature-matrix.md`
- [x] `docs/design-audit.md`, `docs/design-system.md`, `docs/mobile-screen-specifications.md`
- [x] `docs/business-rules.md`
- [x] `docs/system-architecture.md` + ADRs 0001–0009
- [x] `backend/prisma/schema.prisma` (validated), `docs/database-design.md`, `docs/entity-relationship-diagram.md`
- [x] `docs/api-specification.md`, `docs/api-error-handling.md`, `backend/openapi/openapi.yaml` (linted)
- [x] `docs/offline-sync-strategy.md`, `docs/security-guidelines.md`, `docs/testing-strategy.md`
- [x] `docs/implementation-roadmap.md`, `README.md`, `DEVELOPMENT.md`, `ENVIRONMENT.md`, `CHANGELOG.md`
- [x] Owner review: all recommended defaults (D1–D11) accepted on 2026-11-15

## Sprint 1 — Foundation
- [x] S1-01 Repository layout (`backend/`, `mobile/`), lint, type-check, CI workflow *(workflow written; not yet executed — nothing has been pushed to GitHub)*
- [x] S1-02 Docker Compose dev stack and API Dockerfile *(written; not run here — no Docker daemon. Local PostgreSQL via `backend/scripts/db-setup.sh` is what was used)*
- [x] S1-03 NestJS/Fastify skeleton: validated config, request ids, error envelope, response envelope, health, security headers, rate limits
- [x] S1-04 Migrations: schema + SQL constraints, row-level security, append-only privileges; demo seed
- [x] S1-05 Tenant-scoped transactions, money module, idempotency service, audit service
- [x] S1-06 Authentication (sign-in with lockout, refresh rotation with reuse detection, sign-out, password reset/change, `/auth/me`) and deny-by-default authorization
- [x] S1-07 Flutter project: entry points per flavour, Riverpod, go_router shell with five tabs, Dio client with token refresh, secure token storage
- [x] S1-08 Design system: light/dark themes, tokens, bundled fonts, shared components, contrast test, golden screenshots
- [x] S1-09 Sign-in, forgot/reset password, session restore, sign-out

### Carried over from Sprint 1
- [ ] Android and iOS builds and on-device runs — **blocked here** (no Android SDK, no macOS); CI jobs `mobile-android` and `mobile-ios` are defined and will run on the first push
- [ ] Native build flavours (Android `productFlavors`, iOS schemes) and the `velora://` deep-link registration — need the native toolchains to verify; Dart entry points and `--dart-define` config are in place
- [x] Local database — done in Sprint 6 with the `sqlite3` package directly instead of Drift (see ADR-0007 addendum)
- [ ] Freezed / json_serializable — still deferred; models remain hand-written and small
- [ ] Localisation via ARB files — strings are English literals in widgets for now; extract before Sprint 4
- [x] Pagination helper and role-aware product view — built with S2-01
- [x] Appearance setting (System/Light/Dark) — done in Sprint 5
- [x] Remove `NotBuiltYetScreen` from Sell and Documents (S4) — every tab is now real

## Sprint 2 — Products and inventory
- [x] S2-01 Products API: list with search, stock filters, sorting, keyset paging and counts; create with opening stock; detail; edit under optimistic locking; archive; cost fields omitted for the sales role
- [x] S2-03 Stock receipts with weighted-average cost, adjustments with mandatory reason, stock movement ledger
- [x] S2-04 Inventory screens C1–C6: list, product detail, new/edit product, receive stock, adjust stock, stock history
- [x] Barcode as a product field (typed entry and search)

### Moved out of Sprint 2
- [ ] S2-02 Product photos — needs object storage, which this workspace cannot run (no Docker/MinIO), and the camera/gallery picker needs a device. Products show the monogram tile; `imageUrl` is always null. Scheduled with deployment storage in Sprint 6
- [ ] S2-05 Camera barcode scanning — needs a device to build and verify; scheduled with the first device-capable environment
- [x] S2-06 Product cache and delta sync — done in Sprint 6

## Sprint 3 — Customers
- [x] S3-01 Customers API: list with search (name, company, email, phone digits), exact lookup by mobile, create with optional client id, detail with invoiced / outstanding / overdue totals, edit, manager-only archive
- [x] S3-02 Customer screens E1–E3 (directory, detail, new/edit) and the reusable customer picker (D4) for the sale flow
- [x] S3-03 Customer cache and offline create — done in Sprint 6
- [ ] Customer's document list on the detail screen — listed under Sprint 4 "Not in Sprint 4"

## Sprint 4 — Sales and documents
- [x] S4-01 Pricing engine (price bounds, integer totals, tax on the discounted total) and `POST /pricing/preview`
- [x] S4-02 Document numbering; quotations API (create, detail, cancel, expiry)
- [x] S4-03 Invoice issue in one transaction: stock, number, optional first payment, audit, idempotency; concurrency tests
- [x] S4-04 Payments and refunds · S4-05 Cancellation and returns (credit notes) · S4-06 Combined documents list and PDFs
- [x] `GET /tax-rates` (read side, for choosing a rate on a sale; managing rates is S5-04)
- [x] S4-07 Sell flow screens D1–D5: product picker, price sheet, cart (kept across restarts), customer picker, payment
- [x] S4-08 Documents screens F1–F6: list with filters and search, invoice and quotation detail, record payment, cancel, return items, share PDF / WhatsApp
- [x] Live contract test: the app's API client runs the whole sale against the real backend

### Not in Sprint 4
- [ ] **D7 tax rule still needs the accountant's confirmation** — implemented as accepted (one tax-exclusive rate on the discounted total)
- [ ] D6 Drafts screen — the app keeps one cart in progress on the device; several named drafts were not built. Decide in Sprint 6 whether they are still wanted
- [ ] Offline invoices (`offline` field on `POST /invoices`) — Sprint 6 with the outbox
- [ ] Documents list: date range and salesperson filters exist in the API but have no filter sheet in the app; only `-issuedAt` sorting is implemented
- [ ] Sell product list shows the first 50 matches and asks the user to search for more (no infinite scroll)
- [ ] Printing goes through the system share sheet (share PDF → Print); no in-app print preview
- [ ] Customer's document list on the customer detail screen (API supports `customerId`)
- [ ] Sale and document screens have not been run on a physical device (no Android SDK / macOS here) — widget tests, rendered goldens and live API tests only

## Sprint 5 — Dashboard, reports, settings
- [x] S5-01 Dashboard API and Home screen (KPIs, needs attention, recent documents; sales role sees own figures and nothing cost-based)
- [x] S5-02 Reports API: sales summary, sales by salesperson, payment status, inventory valuation; CSV exports for managers
- [x] S5-03 Reports screen: Today / 7 days / This month / Last month / Custom, status breakdown, team comparison, stock value, CSV export through the share sheet
- [x] S5-04 Business settings (owner edits, manager reads), tax-rate management, team (invite by email, change role, remove and restore access)
- [x] S5-05 Signed-in devices list with remote sign-out; appearance setting (same as device / light / dark)
- [x] Live contract test covers every Sprint 5 endpoint with the sales, manager and owner accounts

### Not in Sprint 5
- [ ] **Invitation and password-reset emails need SMTP** (`MAIL_SMTP_URL`). Without it the server only logs that a mail was due, so an invited person cannot get their link. Blocked on hosting (D11)
- [ ] Company logo upload — needs object storage (Sprint 6, with product photos)
- [ ] `allowOfflineSales` is not editable — offline invoicing does not exist yet (Sprint 6)
- [ ] Branch assignment for team members — the UI is single-branch (D9)
- [ ] Reports while offline (last loaded figures with a timestamp) — Sprint 6 with the local cache
- [ ] Report ranges use the device's calendar date; a device set to a different time zone than the business can be a day off at the edges
- [x] Change-password screen — done in Sprint 6
- [x] A role change or removal now takes effect immediately (Sprint 6)
- [ ] Sprint 5 screens have not been run on a physical device — widget tests, rendered goldens and live API tests only

## Sprint 6 — Production readiness (partly delivered; the rest is blocked, see below)
- [x] S6-01 Offline: device copy of products and customers kept current by `GET /sync/changes`; lists, search, product and customer detail, the sell picker and the cart work without a connection; quotations, new customers and payments are queued and sent later; Sync screen with retry and discard; offline start-up from the remembered profile
- [x] S6-02 Security review fixes: a closed session (sign-out, password change, role change, removal, remote sign-out) stops working at once instead of at token expiry; change-password screen
- [x] S6-03 Performance measured with 20k products / 100k invoices (`docs/performance-notes.md`); documents list fixed (1.1 s → 10 ms)
- [x] S6-04 (part) Consistency job `npm run maintenance -- check` and expiry purge `-- purge`
- [x] Deployment runbook written (`docs/deployment-runbook.md`) — **not executed**, no hosting exists yet

### Blocked — needs a decision or equipment this workspace does not have
- [x] D11 decided (2026-11-17): one server with Docker Compose. `deploy/` holds the Compose stack (PostgreSQL, API, Caddy for HTTPS), secrets generator, backup and restore scripts and a step-by-step guide; `create-organization` sets up the first business and owner
- [ ] **S6-05 First real deployment — yours to run** (`deploy/README.md`). Rehearsed locally without Docker: roles, migrations, first organization, API in production mode, backup, restore, consistency check. **Not run: the image build, the Compose stack and Caddy** (no Docker daemon here). Still needed from you: a server, a domain, an SMTP account, an off-server backup target
- [ ] Error monitoring service and alerts — not chosen yet; the API logs structured JSON with request ids
- [ ] **S6-06 Store preparation and S6-07 device testing — need an Android SDK / macOS and devices.** The app has never been built for or run on a phone. In particular the on-device database file (`sqlite3` build hooks, `path_provider`) is unverified on Android and iOS; tests run it in memory on Linux
- [ ] S2-02 Product photos and company logo — need object storage (D11) and a device for the picker
- [ ] S2-05 Camera barcode scanning — needs a device; barcodes can be typed and searched today
- [ ] S6-04 Error monitoring, dashboards and alerts — need a monitoring service (with D11)

### Not built, by choice — say if you want them
- [ ] Offline invoices ("provisional" sales, D8) — off by default in the accepted decisions; an invoice always needs the server
- [ ] Documents are not saved for offline reading; the dashboard and reports need a connection
- [ ] "Edit and resubmit" for a refused queued item — it can be retried or discarded; the content is not reopened in the cart
- [ ] D6 named drafts — one cart in progress is kept per user
- [ ] The device database is not encrypted beyond the platform's app sandbox, and excluding it from device backups needs native configuration (with the first device build)
- [ ] ARB localisation, native build flavours, deep-link registration (carried over from Sprint 1)

## Web app — Sprint W0: discovery and architecture (2026-11-25) — awaiting approval
- [x] Inspect repository, backend routes (51 operations), OpenAPI file (paths match code), mobile app, design documents, reference site (desktop, tablet, phone)
- [x] Angular vs React comparison and recommendation — `docs/web-frontend-architecture-decision.md`
- [x] Architecture, project structure, routing, security — `docs/web-frontend-architecture.md`
- [x] State management with flows for sign-in, stock updates and sales — `docs/web-state-management.md`
- [x] API status matrix and missing backend functionality — `docs/web-api-integration.md`
- [x] Desktop/tablet design audit — `docs/web-design-audit.md`; screen specifications — `docs/web-screen-specifications.md`; design system and components — `docs/web-component-inventory.md`
- [x] Testing strategy — `docs/web-testing-strategy.md`; roadmap, backlog, risks, questions — `docs/web-implementation-roadmap.md`
- [x] Approved 2026-11-25 with the defaults for Q1–Q9 (Angular; B1–B3; same domain; 30-day sessions; no suppliers/purchases/expenses; no optional backend items; English only; personal sign-in; web online-only)

## Web app — Sprint W1: foundation and sign-in (2026-11-25)
**Backend**
- [x] B1 Browser sessions: `/auth/web/login`, `/refresh`, `/logout`; refresh token only in an HttpOnly, Secure, SameSite=Strict cookie scoped to those endpoints; origin + `X-Velora-Client` check; sign-out works with an expired access token
- [x] B2 Reset and invitation emails link to `<APP_BASE_URL>/reset-password` (https, opens in any browser) instead of `velora://`
- [x] B3 Same origin: Caddy serves the web app at `/` and proxies `/api/*`; strict Content-Security-Policy and security headers; web image built from `web/Dockerfile`
- [x] B7 Every response in the backend tests is validated against `openapi.yaml`, including undocumented fields; spec corrected where it had drifted
**Web (`web/`)**
- [x] Angular 22.2 project: strict TypeScript and templates, zoneless, Vitest, ESLint (Angular + template accessibility rules), Playwright; build budgets
- [x] Design tokens (light/dark via `light-dark()`), Material 3 theme from the tokens, self-hosted Inter, Playfair Display and Material Symbols
- [x] API layer: types generated from the OpenAPI file (CI checks they are current), interceptor (bearer token, single refresh on 401, one retry of failed GETs, timeouts), `ApiFailure` and messages identical to the mobile app
- [x] Session: in-memory access token, restore from the cookie, refresh serialised across tabs with Web Locks, sign-out in every tab via BroadcastChannel, return to the same page after re-sign-in
- [x] Guards (signed in, signed out, permission), shell (sidebar ≥1280, rail 840–1279, drawer <840), account menu with appearance
- [x] Screens: sign in, forgot password, reset/set password, dashboard (W-B1, brought forward so the app has a real home page), not found, forbidden; `/dev/ui` design-system page (development builds only)
- [x] Shared components: status pill, state views, skeleton, page header, KPI tile, confirm dialog, toasts, money pipe
- [x] Tests: 35 unit/component tests; 19 end-to-end tests against the **production build**, the production headers, the real API and a seeded database (incl. multi-tab refresh after token expiry, remote sign-out, lock-out, axe accessibility in light and dark, no CSP violations)
- [x] CI job `web` (lint, types current, unit tests, build, e2e) and the web image in the stack job

### Known gaps after W1
- [x] ~~Dashboard tiles and rows are not links yet~~ — stock tile and low/out rows link to the products list since W2; invoice rows wait for W4 (documents)
- [ ] The phone app cannot open the new https reset link itself until Android App Links / iOS Universal Links are configured (needs the native projects); until then the link opens the web page, which works on a phone browser too
- [ ] Only Chromium was run here; Firefox and WebKit are CI/nightly items. Not tried on a real phone
- [ ] Docker stack with Caddy still not run (no Docker daemon here); the CSP and the production build were verified with `web/e2e/serve-dist.mjs`, which applies the Caddyfile's own headers

## Web app — Sprint W2: inventory (2026-11-25)
- [x] W-C1 Products: server search (name, SKU, barcode), stock chips with the server's counts, sort (name, stock, newest), "Show archived" (manager/owner), optional columns remembered per browser, "Load more", cards on phones; filters live in the URL
- [x] W-C2 Product detail: prices, cost and markups (manager/owner only), details, stock with the server's status, last 10 movements with "View all"
- [x] W-C3 New / edit product: integer money and basis-point parsing, price preview (display only; the saved product shows the server's prices), organization maximum markup, SKU/barcode taken shown on the field, optimistic locking with "Someone else changed this product → Reload"; cost and opening stock read-only after creation. **Deviation:** a page, not a drawer (noted in the screen spec)
- [x] W-C4 Receive stock and W-C5 Adjust stock dialogs: one idempotency key per change, kept for a retry after a lost answer; cannot remove more than on hand (checked, then enforced by the API)
- [x] W-C6 Stock history: product, type and date filters; dates are business days in the organization's time zone, converted to exact instants
- [x] Archive with confirmation; refused while stock is on hand (API message)
- [x] Navigation (Products, Stock history; the most specific entry is highlighted), dashboard stock tile and low/out rows link to the filtered list
- [x] Shared: `PagedList` (keyset "Load more", late answers ignored), `LoadMore`, column choice, `Submission` (idempotency keys), money/percent/whole-number validators, org-time-zone day bounds
- [x] **Backend fix found by the e2e tests:** stock entered when a product is created is now recorded as `OPENING` (business rule S4), not `PURCHASE_RECEIPT`
- [x] Tests: 55 unit/component tests; 27 end-to-end tests against the production build and the real API — new: scenarios 4–7 (create, edit with concurrent-edit conflict, receive/adjust with history, low stock on dashboard and filter), archive, axe on the inventory pages, 15 (salesperson sees no cost or actions; API refuses), 16 (a second organization created with `create-organization`: its products never appear, direct links show "not found", API returns 404). Backend: 266 tests

### Known gaps after W2
- [ ] Invoice and credit-note numbers in stock history are plain text until the documents pages exist (W4)
- [ ] Product photos: not in v1 (decision Q5)
- [ ] Axe ran on the inventory pages in the light theme only; dark-theme checks cover W1 pages. Firefox/WebKit and real phones still not run here
- [ ] Movements created before this fix by product creation remain labelled "Received" (only affects databases that already have data)

## Web app — Sprint W3: customers and the sale (2026-11-25)
- [x] W-E1 Customers: search (name, company, email, phone digits), sort, load more, phone cards; filters in the URL. No balance column (needs optional B4 — not faked)
- [x] W-E2 Customer detail: call / WhatsApp / email links, invoiced / outstanding / overdue from the server (a salesperson sees only their own), documents list, edit, archive (manager/owner), "New sale" for this customer
- [x] W-E3 Customer form (page, and compact inside the sale): name or company required; mobile normalized by the server; the customer already saved with the same number is offered before creating another
- [x] W-D1 Sale workspace: product search (sellable only; "/" to focus, ↑↓ Enter), cart saved per user in this browser (survives reloads and an expired session, removed on sign-out), totals and per-line problems only from the server's preview, discount, tax rate, notes, clear sale; phones use Products / Cart steps with a summary bar
- [x] W-D2 Price editor: quantity limited to stock, lowest/highest price, cost/profit/markup for managers and owners only, "sell below the lowest price" with a recorded reason (managers/owners)
- [x] W-D3 Customer picker with "New customer" inside the dialog
- [x] W-D4 Payment: Full / Half / None / Other, cash or bank transfer with reference, credit days with the due date, one outcome sentence, confirmation dialog; one idempotency key per sale, kept for a retry after a lost answer (inputs locked until it is confirmed); a refusal returns to the cart with the problems on the lines
- [x] Quotations: save (no stock taken) and convert with `/sell?quotation=<id>`
- [x] Tests: 63 unit/component tests; 39 end-to-end tests — new: 8 (full cash sale, stock taken, dashboard updated), 9 (stock taken by another device first: nothing created, cart kept, line explains), 10 (part payment by bank transfer with reference and due date), 11 (credit sale; more than the total refused by screen and API), 17 (answer lost after the server issued the invoice: retry with the same key, exactly one invoice; clicks while sending ignored), quotation save + convert, reload keeps the sale, below-minimum with reason + axe, salesperson cannot go below minimum (API refuses too), duplicate mobile, own figures for a salesperson, 16 for customers
- [x] Accessibility fix found by axe: product results no longer nest a button inside a list option

### Known gaps after W3
- [x] ~~After a sale the workspace shows a summary~~ — since W4 a sale opens its invoice page and a quotation its quotation page, as W-D4 specifies
- [x] ~~Converting a quotation has no button~~ — "Convert to sale" on the quotation page (W4)
- [ ] Customer edits are last-write-wins (the API has no version for customers); acceptable at 10 users, noted

## Web app — Sprint W4: documents (2026-11-25)
- [x] W-F1 Documents: type and status filters, search (number, customer, company, mobile), date range, salesperson (managers/owners), balance with due date (red when overdue); newest first; phone cards; filters in the URL
- [x] W-F2 Invoice: status, total, received, credited, balance and due date; bill to; items (cost and markup for managers/owners) and totals; profit card (managers/owners); payments and refunds timeline; credit notes; activity (issued by, from quotation, cancellation)
- [x] W-F3 Quotation: status, valid until, items, link to its invoice; Convert to sale; Cancel
- [x] W-F4 Record payment (defaults to the balance, never more), W-F5 Refund correction (managers/owners, reason recorded), W-F6 Cancel invoice (consequences spelled out, refund method when money was received) — each with one idempotency key and no dismissing while sending
- [x] W-F7 Return items: returnable quantities, "back to stock" per line, reason; credit and refund calculated by the server; the refund method is asked only when the server says a refund is due
- [x] W-F8 PDF: view in a dialog, print, download as `<number>.pdf`; WhatsApp link with the document summary
- [x] Sale workspace now opens the new invoice / quotation page; document numbers on the dashboard, customer page and stock history are links
- [x] Tests: 67 unit/component tests; 47 end-to-end tests — new: 10/11 continued (rest of the balance later, more than the balance refused), 12 (PDF downloads as `INV-….pdf` and is a real PDF; view and print use the server's PDF), 13 (cancel a paid invoice: stock restored, refund recorded; salesperson refused by the API), 14 (return 1 of 2, not restocked: balance cleared first, only the excess refunded), refund correction, documents filters + quotation cancel + axe on list and invoice, salesperson sees only own documents (others' invoice "not found", no return/refund/cancel), 16 for invoices

### Known gaps after W4
- [ ] That print() opens the browser's print dialog cannot be observed in a headless run; the test checks the PDF is loaded into the print frame. Needs a manual check in each browser
- [ ] WhatsApp sends a text with the document summary; the PDF itself is attached by the user (there is no API to send files)
- [ ] Documents are listed newest first only (sorting needs optional backend item B5)

- [ ] W5 Reports, settings, account · W6 Production readiness

## Open blockers
- CI has never run: the workflow triggers on pull requests and on pushes to `main`, and neither has happened yet.
- Android SDK download host is not reachable from the current workspace; iOS builds need macOS (CI).
