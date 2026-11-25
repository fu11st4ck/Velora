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
- [ ] **Approval of W0 and answers to questions Q1–Q9** (`docs/web-implementation-roadmap.md`) — nothing is implemented until then
- [ ] W1 Foundation and sign-in (includes backend B1 web session cookie, B2 https email links, B3 same-origin hosting, B7 contract tests)
- [ ] W2 Dashboard and inventory · W3 Customers and the sale · W4 Documents · W5 Reports, settings, account · W6 Production readiness

## Open blockers
- CI has never run: the workflow triggers on pull requests and on pushes to `main`, and neither has happened yet.
- Android SDK download host is not reachable from the current workspace; iOS builds need macOS (CI).
